import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { createSandboxServer } from './server.mjs';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function send(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method,
      headers: { host: `localhost:${port}`, ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('servidor exige activación y credenciales antes de abrir', () => {
  assert.throws(() => createSandboxServer(), /activación explícita/);
  assert.throws(() => createSandboxServer({ enabled: true, sandboxVerified: false, token: 'fake', storeId: 'fake' }), /credenciales/);
});

test('túnel configurado permite su origen exacto y rechaza otros', async () => {
  const tunnelOrigin = 'https://prueba-8131.use.devtunnels.ms';
  const app = createSandboxServer({ enabled: true, sandboxVerified: true, token: 'fake', storeId: 'fake', dbPath: ':memory:', tunnelOrigin });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const port = app.server.address().port;
  try {
    assert.equal((await send(port, '/')).headers.location, '/renovacion.html');
    const page = await send(port, '/renovacion.html');
    const cookie = page.headers['set-cookie'][0].split(';')[0];
    const headers = { cookie, 'x-local-sandbox': '1' };
    const body = JSON.stringify({ monthly: 1, termsAccepted: true });
    assert.equal((await send(port, '/sandbox-payphone/reservar', { method: 'POST', headers: { ...headers, origin: 'https://otro.use.devtunnels.ms' }, body })).status, 403);
    assert.equal((await send(port, '/sandbox-payphone/reservar', { method: 'POST', headers: { ...headers, origin: tunnelOrigin }, body })).status, 200);
  } finally { app.server.close(); await once(app.server, 'close'); app.closeStore(); }
});

test('reserva local, retorno validado y confirmación con proveedor simulado', async () => {
  let calls = 0;
  const fakeFetch = async (_url, request) => {
    calls++;
    const input = JSON.parse(request.body);
    return { status: 200, text: async () => JSON.stringify({ transactionId: input.id,
      clientTransactionId: input.clientTxId, amount: 966, currency: 'USD', statusCode: 3, transactionStatus: 'Approved' }) };
  };
  const app = createSandboxServer({ enabled: true, sandboxVerified: true, token: 'fake', storeId: 'fake',
    dbPath: ':memory:', fetchImpl: fakeFetch });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const port = app.server.address().port;
  try {
    assert.equal((await send(port, '/sandbox-payphone/reservar', { method: 'POST' })).status, 403);
    assert.equal((await send(port, '/sandbox-payphone', { headers: { host: 'evil.example' } })).status, 403);
    const page = await send(port, '/sandbox-payphone');
    const cookie = page.headers['set-cookie'][0].split(';')[0];
    assert.equal(page.status, 200);
    assert.equal((await send(port, '/sandbox-payphone/reservar', { method: 'POST', headers: {
      cookie, origin: 'https://evil.example', 'x-local-sandbox': '1' } })).status, 403);
    const headers = { cookie, origin: `http://localhost:${port}`, 'x-local-sandbox': '1' };
    assert.equal((await send(port, '/sandbox-payphone/reservar', { method: 'POST', headers, body: JSON.stringify({ monthly: 1 }) })).status, 400);
    const reserved = await send(port, '/sandbox-payphone/reservar', { method: 'POST', headers, body: JSON.stringify({ monthly: 1, termsAccepted: true }) });
    assert.equal(reserved.status, 200);
    const config = JSON.parse(reserved.body);
    assert.equal(config.amount, 966);
    assert.equal((await send(port, '/sandbox-payphone/reservar', { method: 'POST', headers, body: JSON.stringify({ monthly: 1, termsAccepted: true }) })).status, 409);
    assert.equal((await send(port, '/respuesta-payphone.html?id=42&clientTransactionId=bad', { headers: { cookie } })).status, 400);
    const callback = `/respuesta-payphone.html?id=42&clientTransactionId=${config.clientTransactionId}`;
    assert.equal((await send(port, callback)).status, 403);
    const result = await send(port, callback, { headers: { cookie } });
    assert.equal(result.status, 303);
    assert.equal(result.headers.location, '/renovacion.html');
    assert.equal(calls, 1);
    assert.equal((await send(port, callback, { headers: { cookie } })).status, 303);
    assert.equal(calls, 1);
  } finally {
    app.server.close(); await once(app.server, 'close'); app.closeStore();
  }
});

test('el navegador prepara la Cajita con SDK simulado sin contactar a PayPhone', async () => {
  const app = createSandboxServer({ enabled: true, sandboxVerified: true, token: 'fake', storeId: 'fake',
    dbPath: ':memory:', fetchImpl: async () => { throw new Error('Red prohibida'); } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const port = app.server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(`http://localhost:${port}/`)) return route.continue();
      if (url === 'https://cdn.payphonetodoesposible.com/box/v2.0/payphone-payment-box.js') {
        return route.fulfill({ contentType: 'text/javascript', body: `window.PPaymentButtonBox = class {
          constructor(config) { window.testAmount = config.amount; }
          render(id) { document.getElementById(id).textContent = 'Cajita simulada'; }
        }` });
      }
      if (url === 'https://cdn.payphonetodoesposible.com/box/v2.0/payphone-payment-box.css') {
        return route.fulfill({ contentType: 'text/css', body: '' });
      }
      return route.abort();
    });
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(`http://localhost:${port}/sandbox-payphone`);
    await page.locator('#test-terms').check();
    await page.getByRole('button', { name: 'Preparar Cajita de prueba' }).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent !== 'Preparando la operación de prueba…', { timeout: 5000 });
    assert.equal(await page.locator('#pp-button').innerText(), 'Cajita simulada', await page.locator('#status').innerText());
    assert.equal(await page.evaluate(() => window.testAmount), 966);
    await page.clock.fastForward(61000);
    assert.equal(await page.locator('#pp-button').isVisible(), true);
    assert.equal(await page.locator('#status').innerText(), '');
  } finally {
    await browser.close(); app.server.close(); await once(app.server, 'close'); app.closeStore();
  }
});

test('la renovación local envía solo cantidad y el servidor recalcula, también tras recargar', async () => {
  const app = createSandboxServer({ enabled: true, sandboxVerified: true, token: 'fake', storeId: 'fake',
    dbPath: ':memory:', fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      return { status: 200, text: async () => JSON.stringify({ transactionId: body.id,
        clientTransactionId: body.clientTxId, amount: 3450, currency: 'USD', statusCode: 3, transactionStatus: 'Approved' }) };
    } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const port = app.server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(`http://localhost:${port}/`)) return route.continue();
      if (url.endsWith('/payphone-payment-box.js')) return route.fulfill({ contentType: 'text/javascript', body:
        `window.PPaymentButtonBox = class { constructor(config) { window.testAmount = config.amount; } render(id) { document.getElementById(id).textContent = 'Cajita simulada'; } }` });
      if (url.endsWith('/payphone-payment-box.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const page = await context.newPage();
    await page.clock.install();
    let reservations = 0;
    page.on('request', request => { if (request.url().endsWith('/sandbox-payphone/reservar')) reservations++; });
    await page.goto(`http://localhost:${port}/renovacion.html`);
    assert.equal(reservations, 0, 'Abrir la página no debe reservar una operación.');
    await page.locator('[data-monthly]').fill('0');
    await page.locator('[data-method="tarjeta"]').click();
    await page.waitForFunction(() => document.querySelector('#local-payphone-status').textContent.includes('Acepta'));
    assert.equal(reservations, 0, 'Sin aceptar términos no debe abrirse la Cajita.');
    await page.locator('#card-terms').check();
    await page.waitForFunction(() => document.querySelector('#local-payphone-status').textContent.includes('10,000'));
    assert.equal(reservations, 0, 'Una cantidad inválida no debe reservar.');
    await page.locator('[data-monthly]').fill('10');
    const reservation = page.waitForResponse(response => response.url().endsWith('/sandbox-payphone/reservar'));
    await page.locator('[data-method="tarjeta"]').click();
    const config = await (await reservation).json();
    await page.waitForFunction(() => window.testAmount === 3450);
    await page.clock.fastForward(61000);
    assert.equal(await page.locator('#pp-button').isVisible(), true);
    assert.equal(await page.locator('#local-payphone-status').innerText(), '');
    await page.locator('[data-method="banco"]').click();
    await page.locator('[data-method="tarjeta"]').click();
    assert.equal(reservations, 1, 'Cambiar de método no debe crear otro intento.');
    assert.equal(await page.locator('[data-monthly]').isDisabled(), true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-monthly]').disabled);
    assert.equal(await page.locator('[data-monthly]').inputValue(), '10');
    assert.equal(await page.locator('#simulate-renewal').isDisabled(), true);
    await page.goto(`http://localhost:${port}/respuesta-payphone.html?id=42&clientTransactionId=${config.clientTransactionId}`);
    await page.locator('#code-dialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#code-dialog').innerText(), /no se ha enviado ningún correo/i);
    await page.locator('#code-dialog [data-close-dialog]').click();
    await page.waitForFunction(() => document.querySelector('[data-monthly]').disabled);
    await page.locator('[data-method="tarjeta"]').click();
    assert.match(await page.locator('#local-payphone-status').innerText(), /fue aprobada/);
    assert.match(await page.locator('#pending-message strong').innerText(), /aprobada/);
    assert.equal(await page.locator('#simulate-renewal').isDisabled(), true);
  } finally {
    await browser.close(); app.server.close(); await once(app.server, 'close'); app.closeStore();
  }
});

test('el retorno conserva la sesión y la reserva al reiniciar el servidor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-session-'));
  const dbPath = join(dir, 'test.sqlite');
  let app;
  let calls = 0;
  const fakeFetch = async (_url, request) => {
    calls++;
    const body = JSON.parse(request.body);
    return { status: 200, text: async () => JSON.stringify({ transactionId: body.id,
      clientTransactionId: body.clientTxId, amount: 966, currency: 'USD', statusCode: 3, transactionStatus: 'Approved' }) };
  };
  try {
    app = createSandboxServer({ enabled: true, sandboxVerified: true, token: 'fake', storeId: 'fake', dbPath, fetchImpl: fakeFetch });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    let port = app.server.address().port;
    const page = await send(port, '/sandbox-payphone');
    const cookie = page.headers['set-cookie'][0].split(';')[0];
    const headers = { cookie, origin: `http://localhost:${port}`, 'x-local-sandbox': '1' };
    const result = await send(port, '/sandbox-payphone/reservar', { method: 'POST', headers, body: JSON.stringify({ monthly: 1, termsAccepted: true }) });
    const config = JSON.parse(result.body);
    app.server.close(); await once(app.server, 'close'); app.closeStore(); app = null;
    app = createSandboxServer({ enabled: true, sandboxVerified: true, token: 'fake', storeId: 'fake', dbPath, fetchImpl: fakeFetch });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    port = app.server.address().port;
    const callback = await send(port, `/respuesta-payphone.html?id=42&clientTransactionId=${config.clientTransactionId}`, { headers: { cookie } });
    assert.equal(callback.status, 303);
    assert.equal(calls, 1);
  } finally {
    if (app) { app.server.close(); await once(app.server, 'close'); app.closeStore(); }
    rmSync(dir, { recursive: true, force: true });
  }
});
