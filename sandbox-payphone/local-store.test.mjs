import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

test('una declaración manual explícita cierra solo una reserva sin id de proveedor y conserva el historial', () => {
  const store = createLocalAttemptStore({ filename: ':memory:' });
  try {
    assert.equal(store.reserve(order), true);
    assert.throws(() => store.closeManually({ clientTransactionId: order.clientTransactionId }), /Declaración inválida/);
    assert.equal(store.reserve({ ...order, clientTransactionId: 'other' }), false);
    assert.deepEqual(store.recoveryCandidate(order.renewalRef), {
      clientTransactionId: order.clientTransactionId, status: 'reserved', providerTransactionId: null
    });
    assert.equal(store.closeManually({ clientTransactionId: order.clientTransactionId, attestation: 'no_transaction' }), true);
    assert.equal(store.get(order.clientTransactionId).status, 'closed_manually');
    assert.equal(store.closeManually({ clientTransactionId: order.clientTransactionId, attestation: 'no_transaction' }), false);
    assert.equal(store.reserve({ ...order, clientTransactionId: 'other' }), true);
  } finally { store.close(); }
});

test('la recuperación manual no libera confirmaciones, pendientes ni aprobaciones', () => {
  for (const status of ['confirming', 'pending', 'approved']) {
    const store = createLocalAttemptStore({ filename: ':memory:' });
    try {
      assert.equal(store.reserve(order), true);
      assert.equal(store.claim(attempt), true);
      if (status !== 'confirming') assert.equal(store.record({ ...attempt, status }), true);
      assert.equal(store.closeManually({ clientTransactionId: order.clientTransactionId, attestation: 'no_transaction' }), false);
      assert.equal(store.get(order.clientTransactionId).status, status);
      assert.equal(store.reserve({ ...order, clientTransactionId: 'other' }), false);
    } finally { store.close(); }
  }
});

test('migra el registro antiguo sin perder historial y conserva la declaración de pago no enviado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-store-migrate-'));
  const filename = join(dir, 'test.sqlite');
  let legacy, store, verify;
  try {
    legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE sandbox_attempts (
        client_tx_id TEXT PRIMARY KEY, renewal_ref TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        monthly INTEGER NOT NULL CHECK (monthly > 0), currency TEXT NOT NULL,
        provider_id INTEGER, status TEXT NOT NULL CHECK (status IN ('reserved','confirming','pending','approved','canceled'))
      );
      CREATE TABLE sandbox_manual_resolutions (
        client_tx_id TEXT PRIMARY KEY REFERENCES sandbox_attempts(client_tx_id),
        attestation TEXT NOT NULL CHECK (attestation IN ('no_transaction', 'canceled')),
        recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO sandbox_attempts VALUES ('old', 'demo-renewal', 966, 1, 'USD', NULL, 'canceled');
      INSERT INTO sandbox_manual_resolutions VALUES ('old', 'no_transaction', '2026-01-01 00:00:00');
      INSERT INTO sandbox_attempts VALUES ('current', 'demo-renewal', 966, 1, 'USD', NULL, 'reserved');
    `);
    legacy.close(); legacy = null;

    store = createLocalAttemptStore({ filename });
    assert.equal(store.get('old').status, 'closed_manually');
    assert.equal(store.get('current').status, 'reserved');
    assert.equal(store.closeManually({ clientTransactionId: 'current', attestation: 'not_submitted' }), true);
    assert.equal(store.get('current').status, 'closed_manually');
    store.close(); store = null;

    // Reabrir comprueba que la migración no se repite ni cambia el historial.
    store = createLocalAttemptStore({ filename });
    assert.equal(store.get('old').status, 'closed_manually');
    assert.equal(store.get('current').status, 'closed_manually');
    store.close(); store = null;
    verify = new DatabaseSync(filename);
    const rows = verify.prepare('SELECT client_tx_id, attestation, recorded_at FROM sandbox_manual_resolutions ORDER BY client_tx_id').all();
    assert.equal(rows.length, 2);
    assert.equal(rows.find(row => row.client_tx_id === 'old').attestation, 'no_transaction');
    assert.equal(rows.find(row => row.client_tx_id === 'old').recorded_at, '2026-01-01 00:00:00');
    assert.equal(rows.find(row => row.client_tx_id === 'current').attestation, 'not_submitted');
  } finally {
    legacy?.close(); store?.close(); verify?.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('no enviado no libera intentos confirmándose, pendientes ni aprobados', () => {
  for (const status of ['confirming', 'pending', 'approved']) {
    const store = createLocalAttemptStore({ filename: ':memory:' });
    try {
      assert.equal(store.reserve(order), true);
      assert.equal(store.claim(attempt), true);
      if (status !== 'confirming') assert.equal(store.record({ ...attempt, status }), true);
      assert.equal(store.closeManually({ clientTransactionId: order.clientTransactionId, attestation: 'not_submitted' }), false);
      assert.equal(store.get(order.clientTransactionId).status, status);
      assert.equal(store.reserve({ ...order, clientTransactionId: 'other' }), false);
    } finally { store.close(); }
  }
});
