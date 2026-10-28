import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSandboxCajitaConfig } from './cajita-config.mjs';

const input = () => ({
  mode: 'test', sandboxVerified: true, siteOrigin: 'http://localhost:8131',
  token: 'token-ficticio', storeId: 'tienda-ficticia',
  reservation: {
    status: 'reserved', clientTransactionId: 'transaccion-ficticia-1',
    reference: 'Renovación de prueba', currency: 'USD', amount: 3450,
    amountWithoutTax: 0, amountWithTax: 3000, tax: 450, service: 0, tip: 0
  }
});

test('construye el desglose documentado a partir de una reserva ficticia', () => {
  const config = buildSandboxCajitaConfig(input());
  assert.equal(config.amount, 3450);
  assert.equal(config.amountWithTax, 3000);
  assert.equal(config.tax, 450);
  assert.equal(config.clientTransactionId, 'transaccion-ficticia-1');
  assert.equal(config.lang, 'es');
});

test('no se prepara sin la declaración explícita de pruebas', () => {
  for (const overrides of [{ mode: 'production' }, { sandboxVerified: false }, { mode: undefined }]) {
    assert.throws(() => buildSandboxCajitaConfig({ ...input(), ...overrides }));
  }
});

test('rechaza orígenes públicos o con datos extra', () => {
  for (const siteOrigin of ['https://example.com', 'http://localhost.example.com',
    'http://localhost:8131/path', 'http://user:pass@localhost:8131', 'file:///tmp/app']) {
    assert.throws(() => buildSandboxCajitaConfig({ ...input(), siteOrigin }));
  }
  assert.doesNotThrow(() => buildSandboxCajitaConfig({ ...input(), siteOrigin: 'http://127.0.0.1:8131' }));
});

test('requiere una reserva del backend y sus datos mínimos', () => {
  for (const reservation of [null, {}, { ...input().reservation, status: 'pending' },
    { ...input().reservation, clientTransactionId: ' ' },
    { ...input().reservation, clientTransactionId: 'a'.repeat(51) },
    { ...input().reservation, reference: 'a'.repeat(101) },
    { ...input().reservation, currency: 'EUR' }]) {
    assert.throws(() => buildSandboxCajitaConfig({ ...input(), reservation }));
  }
});

test('rechaza cantidades inválidas y totales incongruentes', () => {
  for (const overrides of [{ amount: 3449 }, { amount: 0 }, { amountWithTax: 3000.5 },
    { tax: -1 }, { tip: Number.MAX_SAFE_INTEGER }, { service: NaN }]) {
    assert.throws(() => buildSandboxCajitaConfig({ ...input(), reservation: { ...input().reservation, ...overrides } }));
  }
});

test('no importa el SDK ni utiliza transporte de red', () => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No debe usarse la red.'); };
  try { assert.doesNotThrow(() => buildSandboxCajitaConfig(input())); }
  finally { globalThis.fetch = previous; }
});
