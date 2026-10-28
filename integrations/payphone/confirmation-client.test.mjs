import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayphoneTestConfirmation, PAYPHONE_CONFIRM_URL } from './confirmation-client.mjs';

const demoOrder = {
  renewalRef: 'renovacion-ficticia',
  clientTransactionId: 'transaccion-ficticia',
  amountCents: 3450,
  currency: 'USD'
};

function providerResponse(overrides = {}) {
  return {
    transactionId: 42,
    clientTransactionId: demoOrder.clientTransactionId,
    amount: demoOrder.amountCents,
    currency: 'USD',
    statusCode: 3,
    transactionStatus: 'Approved',
    ...overrides
  };
}

function memoryStore(overrides = {}) {
  const claimed = new Set();
  const renewals = new Set();
  const claims = [];
  const records = [];
  return {
    claims,
    records,
    async claim(attempt) {
      if (claimed.has(attempt.clientTransactionId) || renewals.has(attempt.renewalRef)) return false;
      claimed.add(attempt.clientTransactionId);
      renewals.add(attempt.renewalRef);
      claims.push({ ...attempt, status: 'pending' });
      return true;
    },
    async record(attempt) {
      records.push(attempt);
      if (attempt.status === 'canceled') renewals.delete(attempt.renewalRef);
      return true;
    },
    ...overrides
  };
}

function config(overrides = {}) {
  return {
    mode: 'test',
    sandboxVerified: true,
    token: 'token-ficticio-solo-pruebas',
    transport: async () => ({ httpStatus: 200, data: providerResponse() }),
    attemptStore: memoryStore(),
    timeoutMs: 1000,
    ...overrides
  };
}

function request(overrides = {}) {
  return { id: 42, clientTransactionId: demoOrder.clientTransactionId, order: demoOrder, ...overrides };
}

test('desactivado por defecto y exige verificación explícita del modo de prueba', () => {
  assert.throws(() => createPayphoneTestConfirmation(), /requiere modo de pruebas/);
  assert.throws(() => createPayphoneTestConfirmation(config({ mode: 'production' })), /requiere modo de pruebas/);
  assert.throws(() => createPayphoneTestConfirmation(config({ sandboxVerified: false })), /verificación explícita/);
});

test('sin credenciales, transporte y almacén inyectados no se puede iniciar', () => {
  assert.throws(() => createPayphoneTestConfirmation(config({ token: '' })), /token/);
  assert.throws(() => createPayphoneTestConfirmation(config({ token: 'falso\r\ncabecera' })), /Token inválido/);
  assert.throws(() => createPayphoneTestConfirmation(config({ transport: undefined })), /transporte/);
  assert.throws(() => createPayphoneTestConfirmation(config({ attemptStore: undefined })), /almacén/);
  assert.throws(() => createPayphoneTestConfirmation(config({ timeoutMs: 60001 })), /minuto/);
});

test('envía la solicitud de confirmación documentada usando solo el transporte inyectado', async () => {
  const store = memoryStore();
  let observed;
  const client = createPayphoneTestConfirmation(config({
    attemptStore: store,
    transport: async input => {
      observed = input;
      return { httpStatus: 200, data: providerResponse({ cardNumber: 'no guardar', email: 'no guardar' }) };
    }
  }));
  const outcome = await client.confirm(request({ id: '42' }));
  assert.deepEqual(outcome, { status: 'approved', reason: 'verified' });
  assert.equal(observed.url, PAYPHONE_CONFIRM_URL);
  assert.equal(observed.method, 'POST');
  assert.equal(observed.headers['Content-Type'], 'application/json');
  assert.equal(observed.headers.Authorization, 'Bearer token-ficticio-solo-pruebas');
  assert.deepEqual(observed.json, { id: 42, clientTxId: 'transaccion-ficticia' });
  assert.equal(observed.signal.aborted, false);
  assert.equal(store.records.length, 1);
  assert.equal('cardNumber' in store.records[0], false);
  assert.equal('email' in store.records[0], false);
});

test('reconoce cancelación solo si la respuesta corresponde a la orden', async () => {
  const client = createPayphoneTestConfirmation(config({
    transport: async () => ({ httpStatus: 200, data: providerResponse({ statusCode: 2, transactionStatus: 'Canceled' }) })
  }));
  assert.deepEqual(await client.confirm(request()), { status: 'canceled', reason: 'verified' });
});

test('identificadores, monto, moneda o estado incorrectos permanecen pendientes', async () => {
  const variations = [
    providerResponse({ transactionId: 43 }),
    providerResponse({ clientTransactionId: 'otro' }),
    providerResponse({ amount: 1 }),
    providerResponse({ currency: 'EUR' }),
    providerResponse({ statusCode: 0 }),
    providerResponse({ statusCode: 2, transactionStatus: 'Approved' }),
    providerResponse({ transactionStatus: 'Canceled' }),
    null
  ];
  for (const data of variations) {
    const client = createPayphoneTestConfirmation(config({ transport: async () => ({ httpStatus: 200, data }) }));
    assert.deepEqual(await client.confirm(request()), { status: 'pending', reason: 'unresolved' });
  }
});

test('entrada ajena o datos de orden inválidos no realizan confirmación', async () => {
  let calls = 0;
  const client = createPayphoneTestConfirmation(config({
    transport: async () => { calls++; return { httpStatus: 200, data: providerResponse() }; }
  }));
  assert.equal((await client.confirm(null)).reason, 'invalid_order');
  assert.equal((await client.confirm([])).reason, 'invalid_order');
  assert.equal((await client.confirm(request({ clientTransactionId: 'otra' }))).reason, 'invalid_order');
  assert.equal((await client.confirm(request({ id: '0' }))).reason, 'invalid_order');
  assert.equal((await client.confirm(request({ order: { ...demoOrder, amountCents: 0 } }))).reason, 'invalid_order');
  assert.equal(calls, 0);
});

test('respuestas HTTP fallidas y excepciones del transporte quedan pendientes sin filtrar errores', async () => {
  for (const transport of [
    async () => ({ httpStatus: 500, data: providerResponse() }),
    async () => { throw new Error('token-ficticio-solo-pruebas'); }
  ]) {
    const client = createPayphoneTestConfirmation(config({ transport }));
    const outcome = await client.confirm(request());
    assert.deepEqual(outcome, { status: 'pending', reason: 'unresolved' });
    assert.equal(JSON.stringify(outcome).includes('token-ficticio'), false);
  }
});

test('el mismo intento se confirma una sola vez aunque lleguen solicitudes simultáneas', async () => {
  let calls = 0;
  const client = createPayphoneTestConfirmation(config({
    transport: async () => { calls++; return { httpStatus: 200, data: providerResponse() }; }
  }));
  const [first, second] = await Promise.all([client.confirm(request()), client.confirm(request())]);
  assert.equal(calls, 1);
  assert.deepEqual(new Set([first.status, second.status]), new Set(['approved', 'pending']));
  assert.equal((await client.confirm(request())).reason, 'already_claimed');
  assert.equal(calls, 1);
});

test('el almacén bloquea confirmaciones repetidas entre instancias', async () => {
  let calls = 0;
  const store = memoryStore();
  const settings = config({
    attemptStore: store,
    transport: async () => { calls++; return { httpStatus: 200, data: providerResponse() }; }
  });
  const first = createPayphoneTestConfirmation(settings);
  const second = createPayphoneTestConfirmation(settings);
  assert.equal((await first.confirm(request())).status, 'approved');
  assert.equal((await second.confirm(request())).reason, 'already_claimed');
  assert.equal(calls, 1);
});

test('bloquea un segundo identificador de pago para la misma renovación', async () => {
  let calls = 0;
  const store = memoryStore();
  const settings = config({
    attemptStore: store,
    transport: async () => { calls++; return { httpStatus: 200, data: providerResponse() }; }
  });
  const first = createPayphoneTestConfirmation(settings);
  const second = createPayphoneTestConfirmation(settings);
  assert.equal((await first.confirm(request())).status, 'approved');
  const otherOrder = { ...demoOrder, clientTransactionId: 'otro-intento' };
  assert.equal((await second.confirm(request({ clientTransactionId: 'otro-intento', order: otherOrder }))).reason, 'already_claimed');
  assert.equal(calls, 1);
});

test('si otra instancia cancela, el rechazo definitivo no bloquea el reintento local', async () => {
  let markFirstStarted;
  let releaseFirst;
  let secondCalls = 0;
  const firstStarted = new Promise(resolve => { markFirstStarted = resolve; });
  const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
  const store = memoryStore();
  const first = createPayphoneTestConfirmation(config({
    timeoutMs: 5000,
    attemptStore: store,
    transport: () => { markFirstStarted(); return firstResponse; }
  }));
  const second = createPayphoneTestConfirmation(config({
    attemptStore: store,
    transport: async () => {
      secondCalls++;
      return { httpStatus: 200, data: providerResponse({
        transactionId: 43, clientTransactionId: 'otro-intento'
      }) };
    }
  }));

  const firstResult = first.confirm(request());
  await firstStarted;
  const nextOrder = { ...demoOrder, clientTransactionId: 'otro-intento' };
  const nextRequest = request({ id: 43, clientTransactionId: 'otro-intento', order: nextOrder });
  assert.deepEqual(await second.confirm(nextRequest), { status: 'pending', reason: 'already_claimed' });
  assert.equal(secondCalls, 0);

  releaseFirst({ httpStatus: 200, data: providerResponse({
    statusCode: 2, transactionStatus: 'Canceled'
  }) });
  assert.equal((await firstResult).status, 'canceled');
  assert.deepEqual(await second.confirm(nextRequest), { status: 'approved', reason: 'verified' });
  assert.equal(secondCalls, 1);
});

test('un claim con resultado ambiguo mantiene el bloqueo local', async () => {
  for (const result of [undefined, null, 0, 'false']) {
    let calls = 0;
    const client = createPayphoneTestConfirmation(config({
      attemptStore: memoryStore({ claim: async () => result }),
      transport: async () => { calls++; return { httpStatus: 200, data: providerResponse() }; }
    }));
    assert.deepEqual(await client.confirm(request()), { status: 'pending', reason: 'claim_unavailable' });
    const nextOrder = { ...demoOrder, clientTransactionId: 'otro-intento' };
    assert.equal((await client.confirm(request({ id: 43, clientTransactionId: 'otro-intento', order: nextOrder }))).reason, 'already_claimed');
    assert.equal(calls, 0);
  }
});
test('cancelación confirmada permite nuevo intento para la renovación', async () => {
  let calls = 0;
  const store = memoryStore();
  const client = createPayphoneTestConfirmation(config({
    attemptStore: store,
    transport: async ({ json }) => {
      calls++;
      return { httpStatus: 200, data: providerResponse({
        clientTransactionId: json.clientTxId,
        statusCode: calls === 1 ? 2 : 3,
        transactionStatus: calls === 1 ? 'Canceled' : 'Approved'
      }) };
    }
  }));
  assert.equal((await client.confirm(request())).status, 'canceled');
  const retryOrder = { ...demoOrder, clientTransactionId: 'nuevo-intento' };
  assert.equal((await client.confirm(request({ clientTransactionId: 'nuevo-intento', order: retryOrder }))).status, 'approved');
  assert.equal(calls, 2);
});
test('un retorno inválido no se reintenta a ciegas y requiere conciliación', async () => {
  let calls = 0;
  const client = createPayphoneTestConfirmation(config({
    transport: async () => { calls++; return { httpStatus: 200, data: null }; }
  }));
  assert.equal((await client.confirm(request({ id: 99 }))).status, 'pending');
  assert.equal((await client.confirm(request({ id: 42 }))).reason, 'already_claimed');
  assert.equal(calls, 1);
});
test('si el proveedor no responde, se aborta la espera y el resultado sigue pendiente', async () => {
  let observedSignal;
  let calls = 0;
  const store = memoryStore();
  const client = createPayphoneTestConfirmation(config({
    timeoutMs: 15,
    attemptStore: store,
    transport: input => { calls++; observedSignal = input.signal; return new Promise(() => {}); }
  }));
  const outcome = await client.confirm(request());
  assert.deepEqual(outcome, { status: 'pending', reason: 'provider_timeout' });
  assert.equal(observedSignal.aborted, true);
  assert.deepEqual(store.claims, [{
    renewalRef: 'renovacion-ficticia',
    clientTransactionId: 'transaccion-ficticia',
    providerTransactionId: 42,
    status: 'pending'
  }]);
  assert.equal(store.records.length, 0);
  assert.equal((await client.confirm(request())).reason, 'already_claimed');

  const other = createPayphoneTestConfirmation(config({
    attemptStore: store,
    transport: async () => { calls++; return { httpStatus: 200, data: providerResponse() }; }
  }));
  const nextOrder = { ...demoOrder, clientTransactionId: 'otro-intento' };
  assert.equal((await other.confirm(request({ id: 43, clientTransactionId: 'otro-intento', order: nextOrder }))).reason, 'already_claimed');
  assert.equal(calls, 1);
});

test('fallo o demora de claim no envía solicitudes', async () => {
  for (const claim of [
    async () => { throw new Error('almacén no disponible'); },
    () => new Promise(() => {})
  ]) {
    let calls = 0;
    const client = createPayphoneTestConfirmation(config({
      timeoutMs: 15,
      attemptStore: memoryStore({ claim }),
      transport: async () => { calls++; return { httpStatus: 200, data: providerResponse() }; }
    }));
    assert.deepEqual(await client.confirm(request()), { status: 'pending', reason: 'claim_unavailable' });
    assert.equal(calls, 0);
    assert.equal((await client.confirm(request())).reason, 'already_claimed');
  }
});

test('un rechazo del almacén que llega después del timeout no libera el bloqueo', async () => {
  let calls = 0;
  const client = createPayphoneTestConfirmation(config({
    timeoutMs: 10,
    attemptStore: memoryStore({ claim: () => new Promise(resolve => setTimeout(() => resolve(false), 35)) }),
    transport: async () => { calls++; return { httpStatus: 200, data: providerResponse() }; }
  }));
  assert.deepEqual(await client.confirm(request()), { status: 'pending', reason: 'claim_unavailable' });
  await new Promise(resolve => setTimeout(resolve, 45));
  const nextOrder = { ...demoOrder, clientTransactionId: 'otro-intento' };
  assert.equal((await client.confirm(request({ id: 43, clientTransactionId: 'otro-intento', order: nextOrder }))).reason, 'already_claimed');
  assert.equal(calls, 0);
});

test('una aprobación tardía no cambia el timeout ni libera la renovación', async () => {
  let calls = 0;
  const store = memoryStore();
  const client = createPayphoneTestConfirmation(config({
    timeoutMs: 10,
    attemptStore: store,
    transport: () => {
      calls++;
      return new Promise(resolve => setTimeout(() => resolve({ httpStatus: 200, data: providerResponse() }), 35));
    }
  }));
  assert.deepEqual(await client.confirm(request()), { status: 'pending', reason: 'provider_timeout' });
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(store.records.length, 0);
  const nextOrder = { ...demoOrder, clientTransactionId: 'otro-intento' };
  assert.equal((await client.confirm(request({ id: 43, clientTransactionId: 'otro-intento', order: nextOrder }))).reason, 'already_claimed');
  assert.equal(calls, 1);
});
test('si el resultado no se persiste se mantiene pendiente y no se repite', async () => {
  for (const record of [
    async () => false,
    async () => { throw new Error('falló escritura'); },
    () => new Promise(() => {})
  ]) {
    let calls = 0;
    const client = createPayphoneTestConfirmation(config({
      timeoutMs: 15,
      attemptStore: memoryStore({ record }),
      transport: async () => { calls++; return { httpStatus: 200, data: providerResponse() }; }
    }));
    assert.deepEqual(await client.confirm(request()), { status: 'pending', reason: 'record_unavailable' });
    assert.equal((await client.confirm(request())).reason, 'already_claimed');
    assert.equal(calls, 1);
  }
});

test('nunca utiliza fetch global ni otro transporte implícito', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('red prohibida'); };
  try {
    const client = createPayphoneTestConfirmation(config());
    assert.equal((await client.confirm(request())).status, 'approved');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
