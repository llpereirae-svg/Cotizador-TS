import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalAttemptStore } from './local-store.mjs';
import { recoveryDialogue } from './recuperar-ensayo.mjs';

const order = { renewalRef: 'demo-unica', clientTransactionId: 'local-fixture', amountCents: 966, monthly: 1, currency: 'USD' };

async function answerDialogue(store, text) {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = '';
  output.on('data', chunk => { printed += chunk.toString(); });
  const run = recoveryDialogue({ store, input, output });
  input.end(`${text}\n`);
  await run;
  return printed;
}

test('el diálogo Enter conserva el bloqueo y una declaración explícita registra el cierre', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'pp-recovery-test-'));
  const store = createLocalAttemptStore({ filename: join(folder, 'fixture.sqlite') });
  try {
    assert.equal(store.reserve(order), true);
    const skipped = await answerDialogue(store, '');
    assert.match(skipped, /reserva sigue bloqueada/);
    assert.equal(store.get(order.clientTransactionId).status, 'reserved');
    assert.equal(store.reserve({ ...order, clientTransactionId: 'other' }), false);
    const closed = await answerDialogue(store, 'NO EXISTE');
    assert.match(closed, /Cierre manual registrado/);
    assert.equal(store.get(order.clientTransactionId).status, 'closed_manually');
    assert.equal(store.reserve({ ...order, clientTransactionId: 'other' }), true);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('el diálogo no solicita ni permite cierre de una operación en confirmación', async () => {
  const store = createLocalAttemptStore({ filename: ':memory:' });
  try {
    assert.equal(store.reserve(order), true);
    assert.equal(store.claim({ renewalRef: order.renewalRef, clientTransactionId: order.clientTransactionId, providerTransactionId: 42 }), true);
    const printed = await answerDialogue(store, 'NO EXISTE');
    assert.match(printed, /no puede cerrarse manualmente/);
    assert.equal(store.get(order.clientTransactionId).status, 'confirming');
  } finally { store.close(); }
});

test('NO PAGUE declara explícitamente que no se ingresó tarjeta ni se envió pago', async () => {
  const store = createLocalAttemptStore({ filename: ':memory:' });
  try {
    assert.equal(store.reserve(order), true);
    const printed = await answerDialogue(store, 'NO PAGUE');
    assert.match(printed, /Cierre manual registrado/);
    assert.equal(store.get(order.clientTransactionId).status, 'closed_manually');
    assert.equal(store.reserve({ ...order, clientTransactionId: 'other' }), true);
  } finally { store.close(); }
});

test('NO PAGUE no permite cerrar una operación en confirmación, pendiente o aprobada', async () => {
  for (const status of ['confirming', 'pending', 'approved']) {
    const store = createLocalAttemptStore({ filename: ':memory:' });
    try {
      assert.equal(store.reserve(order), true);
      const attempt = { renewalRef: order.renewalRef, clientTransactionId: order.clientTransactionId, providerTransactionId: 42 };
      assert.equal(store.claim(attempt), true);
      if (status !== 'confirming') assert.equal(store.record({ ...attempt, status }), true);
      const printed = await answerDialogue(store, 'NO PAGUE');
      assert.match(printed, /no puede cerrarse manualmente/);
      assert.equal(store.get(order.clientTransactionId).status, status);
    } finally { store.close(); }
  }
});
