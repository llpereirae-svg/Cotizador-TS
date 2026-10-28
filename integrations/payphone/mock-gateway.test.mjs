import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConfirmBody,
  createPayphoneSimulation,
  evaluateMockConfirmation
} from './mock-gateway.mjs';

function fixture(overrides = {}) {
  return {
    transactionId: 42,
    clientTransactionId: 'simulacion-001',
    amount: 3450,
    currency: 'USD',
    statusCode: 3,
    transactionStatus: 'Approved',
    ...overrides
  };
}

function newAttempt(simulation, overrides = {}) {
  return simulation.createAttempt({
    renewalRef: 'renovacion-ejemplo',
    clientTransactionId: 'simulacion-001',
    amountCents: 3450,
    currency: 'USD',
    ...overrides
  });
}

test('el adaptador solo se inicia en modo simulado', () => {
  assert.throws(() => createPayphoneSimulation(), /solo admite/);
  assert.throws(() => createPayphoneSimulation({ mode: 'production' }), /solo admite/);
  assert.doesNotThrow(() => createPayphoneSimulation({ mode: 'mock' }));
});

test('construye el cuerpo de confirmación documentado y valida el retorno', () => {
  assert.deepEqual(buildConfirmBody({ id: '42', clientTransactionId: 'simulacion-001' }),
    { id: 42, clientTxId: 'simulacion-001' });
  for (const id of ['', '0', '-1', '1.5', '123xyz', 0, -1, 2.1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildConfirmBody({ id, clientTransactionId: 'simulacion-001' }));
  }
  assert.throws(() => buildConfirmBody({ id: 42, clientTransactionId: ' ' }));
});

test('una creación duplicada devuelve el mismo intento y rechaza datos distintos', () => {
  const sim = createPayphoneSimulation({ mode: 'mock' });
  assert.deepEqual(newAttempt(sim), newAttempt(sim));
  assert.throws(() => newAttempt(sim, { amountCents: 100 }), /otra operación/);
  assert.throws(() => newAttempt(sim, { renewalRef: 'otra' }), /otra operación/);
});

test('si se agota la espera, permanece pendiente y bloquea un segundo intento', () => {
  const sim = createPayphoneSimulation({ mode: 'mock' });
  newAttempt(sim);
  assert.equal(sim.markTimedOut('simulacion-001').status, 'pending');
  assert.throws(() => newAttempt(sim, { clientTransactionId: 'simulacion-002' }), /pendiente o aprobada/);
});

test('la aprobación verificada debe coincidir con la orden, moneda e identificadores', () => {
  const sim = createPayphoneSimulation({ mode: 'mock' });
  newAttempt(sim);
  const result = sim.applyMockConfirmation({
    id: 42,
    clientTransactionId: 'simulacion-001',
    response: fixture({ cardNumber: 'dato sensible ficticio', email: 'dato no utilizado' })
  });
  assert.equal(result.status, 'approved');
  assert.equal(result.amountCents, 3450);
  assert.equal(result.providerTransactionId, 42);
  assert.equal('cardNumber' in result, false);
  assert.equal('email' in result, false);
  assert.throws(() => newAttempt(sim, { clientTransactionId: 'simulacion-002' }), /pendiente o aprobada/);
});

test('un retorno repetido es idempotente y un identificador distinto se rechaza', () => {
  const sim = createPayphoneSimulation({ mode: 'mock' });
  newAttempt(sim);
  const first = sim.applyMockConfirmation({ id: 42, clientTransactionId: 'simulacion-001', response: fixture() });
  const second = sim.applyMockConfirmation({ id: 42, clientTransactionId: 'simulacion-001', response: null });
  assert.deepEqual(first, second);
  assert.throws(() => sim.applyMockConfirmation({ id: 43, clientTransactionId: 'simulacion-001', response: fixture() }), /no coincide/);
});

test('valores incongruentes y estados desconocidos nunca se dan por aprobados', () => {
  const expected = { id: 42, clientTransactionId: 'simulacion-001', expectedAmountCents: 3450, currency: 'USD' };
  for (const response of [
    null,
    fixture({ amount: 1 }),
    fixture({ currency: 'EUR' }),
    fixture({ transactionId: 43 }),
    fixture({ clientTransactionId: 'otro' }),
    fixture({ statusCode: 99 }),
    fixture({ transactionStatus: 'Canceled' }),
    fixture({ statusCode: 2, transactionStatus: 'Approved' })
  ]) {
    assert.equal(evaluateMockConfirmation({ ...expected, response }), 'pending');
  }
});

test('un retorno no verificado no fija un id ajeno ni bloquea una confirmación posterior válida', () => {
  const sim = createPayphoneSimulation({ mode: 'mock' });
  newAttempt(sim);
  const uncertain = sim.applyMockConfirmation({ id: 99, clientTransactionId: 'simulacion-001', response: null });
  assert.equal(uncertain.status, 'pending');
  assert.equal(uncertain.providerTransactionId, null);
  const approved = sim.applyMockConfirmation({ id: 42, clientTransactionId: 'simulacion-001', response: fixture() });
  assert.equal(approved.status, 'approved');
});

test('una cancelación verificada permite otro intento con un nuevo identificador', () => {
  const sim = createPayphoneSimulation({ mode: 'mock' });
  newAttempt(sim);
  const canceled = sim.applyMockConfirmation({
    id: 42,
    clientTransactionId: 'simulacion-001',
    response: fixture({ statusCode: 2, transactionStatus: 'Canceled' })
  });
  assert.equal(canceled.status, 'canceled');
  assert.equal(newAttempt(sim, { clientTransactionId: 'simulacion-002' }).status, 'pending');
});

test('la simulación nunca requiere ni invoca la red', () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; throw new Error('La red está prohibida en esta prueba.'); };
  try {
    const sim = createPayphoneSimulation({ mode: 'mock' });
    newAttempt(sim);
    sim.markTimedOut('simulacion-001');
    sim.applyMockConfirmation({ id: 42, clientTransactionId: 'simulacion-001', response: fixture() });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
