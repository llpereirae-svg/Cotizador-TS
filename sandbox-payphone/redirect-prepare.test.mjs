import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareRedirect } from './redirect-prepare.mjs';
import { calculateQuote } from '../assets/quote.js';

const transactionId = 'local-00000000-0000-4000-8000-000000000000';
const args = { monthly: 10, transactionId, origin: 'https://demo-8131.use.devtunnels.ms',
  storeId: 'simulado', calculateQuote };
test('prepara importe y direcciones del botón con transporte simulado', async () => {
  let payload;
  const url = await prepareRedirect({ ...args, transport: async body => {
    payload = body; return { payWithCard: 'https://pay.payphonetodoesposible.com/Anonymous/Index?paymentId=demo' };
  } });
  assert.equal(payload.amount, 3450);
  assert.equal(payload.clientTransactionId, transactionId);
  assert.match(payload.cancellationUrl, /cancelacion-payphone\.html\?orden=/);
  assert.match(url, /^https:\/\/pay\.payphonetodoesposible\.com\//);
});
test('rechaza redirecciones externas y origen ajeno', async () => {
  await assert.rejects(prepareRedirect({ ...args, transport: async () => ({ payWithCard: 'https://otro.example/' }) }));
  await assert.rejects(prepareRedirect({ ...args, origin: 'https://otro.example', transport: async () => ({}) }));
});
