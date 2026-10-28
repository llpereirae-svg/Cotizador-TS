import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxCajitaMount } from './cajita-mount.mjs';

const reserve = () => ({
  status: 'reserved', clientTransactionId: 'transaccion-ficticia-1',
  reference: 'Renovación de prueba', currency: 'USD', amount: 3450,
  amountWithoutTax: 0, amountWithTax: 3000, tax: 450, service: 0, tip: 0
});
const pageDocument = () => ({
  defaultView: { location: { origin: 'http://localhost:8131' } },
  getElementById: id => id === 'pp-button' ? { remove() {} } : null
});
const options = () => ({
  mode: 'test', sandboxVerified: true, siteOrigin: 'http://localhost:8131',
  token: 'token-ficticio', storeId: 'tienda-ficticia', document: pageDocument(),
  requestReservation: async () => reserve(),
  widgetConstructor: class { render() {} }
});

test('un clic explícito obtiene reserva y monta el SDK inyectado con parámetros válidos', async () => {
  const calls = [];
  const input = options();
  input.requestReservation = async (...args) => { calls.push(['reserve', args]); return reserve(); };
  input.widgetConstructor = class {
    constructor(config) { calls.push(['constructor', config]); }
    render(id) { calls.push(['render', id]); }
  };
  const bridge = createSandboxCajitaMount(input);
  assert.deepEqual(calls, []);
  assert.deepEqual(await bridge.mount('pp-button'), { status: 'mounted' });
  assert.deepEqual(calls.map(call => call[0]), ['reserve', 'constructor', 'render']);
  assert.deepEqual(calls[0][1], []); // Nunca se envía el token al reservador.
  assert.equal(calls[1][1].amount, 3450);
  assert.equal(calls[2][1], 'pp-button');
});

test('falla cerrado si el entorno, documento o dependencias no corresponden', async () => {
  for (const overrides of [
    { mode: 'production' }, { sandboxVerified: false }, { siteOrigin: 'https://example.com' },
    { document: null }, { document: { ...pageDocument(), defaultView: { location: { origin: 'http://localhost:8132' } } } },
    { requestReservation: null }, { widgetConstructor: null }
  ]) assert.throws(() => createSandboxCajitaMount({ ...options(), ...overrides }));
  const bridge = createSandboxCajitaMount(options());
  await assert.rejects(bridge.mount('missing'));
  await assert.rejects(bridge.mount('../unsafe'));
});

test('una reserva inválida no ejecuta el constructor y no se reintenta automáticamente', async () => {
  let constructed = 0;
  const input = options();
  input.requestReservation = async () => ({ ...reserve(), status: 'pending' });
  input.widgetConstructor = class { constructor() { constructed++; } render() {} };
  const bridge = createSandboxCajitaMount(input);
  assert.deepEqual(await bridge.mount('pp-button'), { status: 'pending', reason: 'integration_error' });
  await assert.rejects(bridge.mount('pp-button'), /ya fue iniciada/);
  assert.equal(constructed, 0);
});

test('dos aperturas simultáneas no ejecutan dos reservas en la misma instancia', async () => {
  let calls = 0;
  let complete;
  const reservation = new Promise(resolve => { complete = resolve; });
  const input = options();
  input.requestReservation = async () => { calls++; return reservation; };
  const bridge = createSandboxCajitaMount(input);
  const first = bridge.mount('pp-button');
  await assert.rejects(bridge.mount('pp-button'), /ya fue iniciada/);
  complete(reserve());
  assert.deepEqual(await first, { status: 'mounted' });
  assert.equal(calls, 1);
});

test('errores del SDK no se propagan con secretos ni permiten reintento automático', async () => {
  const input = options();
  input.widgetConstructor = class { constructor() { throw new Error('token-ficticio'); } };
  const bridge = createSandboxCajitaMount(input);
  assert.deepEqual(await bridge.mount('pp-button'), { status: 'pending', reason: 'integration_error' });
  await assert.rejects(bridge.mount('pp-button'), /ya fue iniciada/);
});

test('el puente no usa transporte implícito', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No debe usarse la red.'); };
  try { assert.deepEqual(await createSandboxCajitaMount(options()).mount('pp-button'), { status: 'mounted' }); }
  finally { globalThis.fetch = previous; }
});

test('el plazo de reserva agotado queda pendiente y nunca monta una respuesta tardía', async () => {
  let complete;
  let constructed = 0;
  let removed = false;
  const pendingReservation = new Promise(resolve => { complete = resolve; });
  const input = options();
  input.timeoutMs = 10;
  input.document.getElementById = () => ({ remove() { removed = true; } });
  input.requestReservation = () => pendingReservation;
  input.widgetConstructor = class { constructor() { constructed++; } render() {} };
  const bridge = createSandboxCajitaMount(input);
  assert.deepEqual(await bridge.mount('pp-button'), { status: 'pending', reason: 'reservation_timeout' });
  assert.equal(removed, true);
  complete(reserve());
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(constructed, 0);
  await assert.rejects(bridge.mount('pp-button'), /ya fue iniciada/);
});

test('si el SDK no termina, se retira el contenedor y no se permite reintentar', async () => {
  let complete;
  let removed = false;
  const renderWait = new Promise(resolve => { complete = resolve; });
  const input = options();
  input.timeoutMs = 10;
  input.document.getElementById = () => ({ remove() { removed = true; } });
  input.widgetConstructor = class { render() { return renderWait; } };
  const bridge = createSandboxCajitaMount(input);
  assert.deepEqual(await bridge.mount('pp-button'), { status: 'pending', reason: 'sdk_timeout' });
  assert.equal(removed, true);
  complete();
  await assert.rejects(bridge.mount('pp-button'), /ya fue iniciada/);
});

test('rechaza esperas mayores a un minuto o inválidas', () => {
  for (const timeoutMs of [0, -1, 60001, 1.5, NaN]) {
    assert.throws(() => createSandboxCajitaMount({ ...options(), timeoutMs }));
  }
});
