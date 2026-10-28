import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalAttemptStore } from './local-store.mjs';
import { createPayphoneTestConfirmation } from '../integrations/payphone/confirmation-client.mjs';

const order = { renewalRef: 'demo-renewal', clientTransactionId: 'demo-order', amountCents: 3450, currency: 'USD', monthly: 10 };
const attempt = { renewalRef: order.renewalRef, clientTransactionId: order.clientTransactionId, providerTransactionId: 42 };

test('reserva única se conserva tras reinicio y bloquea otra instancia', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-store-'));
  const filename = join(dir, 'test.sqlite');
  let first, second;
  try {
    first = createLocalAttemptStore({ filename });
    second = createLocalAttemptStore({ filename });
    assert.equal(first.session('sesion-original'), 'sesion-original');
    assert.equal(second.session('nueva-sesion'), 'sesion-original');
    assert.equal(first.reserve(order), true);
    assert.equal(second.reserve({ ...order, clientTransactionId: 'other' }), false);
    assert.equal(second.claim(attempt), true);
    assert.equal(first.claim(attempt), false);
    assert.equal(first.record({ ...attempt, status: 'pending' }), true);
    first.close(); first = null;
    assert.equal(second.get(order.clientTransactionId).status, 'pending');
    assert.equal(second.reserve({ ...order, clientTransactionId: 'other' }), false);
  } finally {
    first?.close(); second?.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('solo una cancelación confirmada permite reservar otra vez', () => {
  const store = createLocalAttemptStore({ filename: ':memory:' });
  try {
    assert.equal(store.reserve(order), true);
    assert.equal(store.claim(attempt), true);
    assert.equal(store.record({ ...attempt, providerTransactionId: 43, status: 'canceled' }), false);
    assert.equal(store.reserve({ ...order, clientTransactionId: 'other' }), false);
    assert.equal(store.record({ ...attempt, status: 'canceled' }), true);
    assert.equal(store.reserve({ ...order, clientTransactionId: 'other' }), true);
  } finally { store.close(); }
});

test('confirmación real solo con transporte inyectado; coteja reserva y monto', async () => {
  const store = createLocalAttemptStore({ filename: ':memory:' });
  let count = 0;
  try {
    store.reserve(order);
    const client = createPayphoneTestConfirmation({ mode: 'test', sandboxVerified: true,
      token: 'fake-token', attemptStore: store, transport: async () => {
        count++;
        return { httpStatus: 200, data: { transactionId: 42, clientTransactionId: order.clientTransactionId,
          amount: order.amountCents, currency: 'USD', statusCode: 3, transactionStatus: 'Approved' } };
      }
    });
    assert.equal((await client.confirm({ id: 42, clientTransactionId: order.clientTransactionId,
      order: store.get(order.clientTransactionId) })).status, 'approved');
    assert.equal(store.get(order.clientTransactionId).status, 'approved');
    assert.equal((await client.confirm({ id: 42, clientTransactionId: order.clientTransactionId,
      order: store.get(order.clientTransactionId) })).reason, 'already_claimed');
    assert.equal(count, 1);
  } finally { store.close(); }
});
