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
  const events = [];
  const fakeFetch = async (_url, request) => {
    calls++;
    const input = JSON.parse(request.body);
    return { status: 200, text: async () => JSON.stringify({ transactionId: input.id,
      clientTransactionId: input.clientTxId, amount: 966, currency: 'USD', statusCode: 3, transactionStatus: 'Approved' }) };
  };
  const app = createSandboxServer({ enabled: true, sandboxVerified: true, token: 'fake', storeId: 'fake',
    dbPath: ':memory:', fetchImpl: fakeFetch, logger: event => events.push(event) });
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
    assert.equal(result.headers.location, '/renovacion.html?pago=aprobado');
    assert.equal(calls, 1);
    assert.deepEqual(events, ['reserva_creada', 'reserva_rechazada_operacion_activa', 'retorno_recibido', 'confirmacion_iniciada', 'confirmacion_aprobada']);
    assert.equal((await send(port, callback, { headers: { cookie } })).status, 303);
    assert.equal(calls, 1);
  } finally {
    app.server.close(); await once(app.server, 'close'); app.closeStore();
  }
});

test('cancelación confirmada vuelve a las opciones sin inventar el estado', async () => {
  const app = createSandboxServer({ enabled: true, sandboxVerified: true, token: 'fake', storeId: 'fake', dbPath: ':memory:',
    fetchImpl: async (_url, request) => { const input = JSON.parse(request.body); return { status: 200, text: async () => JSON.stringify({ transactionId: input.id, clientTransactionId: input.clientTxId, amount: 966, currency: 'USD', statusCode: 2, transactionStatus: 'Canceled' }) }; } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const port = app.server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await send(port, '/renovacion.html'); const cookie = page.headers['set-cookie'][0].split(';')[0];
    const headers = { cookie, origin: `http://localhost:${port}`, 'x-local-sandbox': '1' };
    const reserved = await send(port, '/sandbox-payphone/reservar', { method: 'POST', headers, body: JSON.stringify({ monthly: 1, termsAccepted: true }) });
    const id = JSON.parse(reserved.body).clientTransactionId;
    const result = await send(port, `/respuesta-payphone.html?id=42&clientTransactionId=${id}`, { headers: { cookie } });
    assert.equal(result.status, 303); assert.match(result.headers.location, /cancelada=/);
    const state = JSON.parse((await send(port, `/sandbox-payphone/estado?cancelada=${id}`, { headers: { cookie } })).body);
    assert.equal(state.canceled, true); assert.equal(state.active, null);
    const unknown = JSON.parse((await send(port, '/sandbox-payphone/estado?cancelada=local-00000000-0000-0000-0000-000000000000', { headers: { cookie } })).body);
    assert.equal(unknown.canceled, false);
    const ui = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await ui.goto(`http://localhost:${port}${result.headers.location}`);
    await ui.locator('#card-resolution-message').waitFor({ state: 'visible' });
    assert.match(await ui.locator('#card-resolution-message').innerText(), /Transacción cancelada/);
    assert.equal(await ui.locator('[data-method=banco]').isVisible(), true);
    assert.equal(await ui.locator('#card-terms').isDisabled(), false);
  } finally { await browser.close(); app.server.close(); await once(app.server, 'close'); app.closeStore(); }
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

test('botón de redirección prepara una sola orden y no declara cancelación al regresar', async () => {
  let requestBody;
  const app = createSandboxServer({ enabled: true, sandboxVerified: true, token: 'fake', storeId: 'fake', dbPath: ':memory:', fetchImpl: async (_url, request) => {
    requestBody = JSON.parse(request.body);
    return { ok: true, json: async () => ({ payWithCard: 'https://pay.payphonetodoesposible.com/Anonymous/Index?paymentId=demo' }) };
  } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const port = app.server.address().port;
  try {
    const page = await send(port, '/sandbox-payphone/boton');
    const cookie = page.headers['set-cookie'][0].split(';')[0];
    const headers = { cookie, origin: `http://localhost:${port}`, 'x-local-sandbox': '1' };
    const created = await send(port, '/sandbox-payphone/boton/preparar', { method: 'POST', headers });
    assert.equal(created.status, 200);
    assert.equal(requestBody.amount, 3450);
    assert.equal((await send(port, '/sandbox-payphone/boton/preparar', { method: 'POST', headers })).status, 409);
    const back = await send(port, `/cancelacion-payphone.html?orden=${requestBody.clientTransactionId}`, { headers: { cookie } });
    assert.equal(back.status, 303);
    assert.equal(back.headers.location, '/renovacion.html?regreso=boton');
    assert.equal(JSON.parse((await send(port, '/sandbox-payphone/estado', { headers: { cookie } })).body).active.status, 'reserved');
  } finally { app.server.close(); await once(app.server, 'close'); app.closeStore(); }
});

test('al volver del botón permite editar sin liberar la orden ni permitir otro pago', async () => {
  let prepared;
  const app = createSandboxServer({ enabled: true, sandboxVerified: true, token: 'fake', storeId: 'fake', dbPath: ':memory:',
    fetchImpl: async (_url, request) => { prepared = JSON.parse(request.body); return { ok: true, json: async () => ({ payWithCard: 'https://pay.payphonetodoesposible.com/Anonymous/Index?paymentId=demo' }) }; } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const port = app.server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}/sandbox-payphone/boton`);
    await page.evaluate(() => fetch('/sandbox-payphone/boton/preparar', { method: 'POST', headers: { 'X-Local-Sandbox': '1' } }));
    await page.goto(`http://localhost:${port}/cancelacion-payphone.html?orden=${prepared.clientTransactionId}`);
    await page.waitForFunction(() => !document.querySelector('[data-monthly]').disabled);
    assert.equal(await page.locator('#payment-card').isVisible(), false);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('[data-monthly]').disabled);
    await page.locator('[data-monthly]').fill('12');
    await page.locator('#confirm-plan').click();
    await page.locator('[data-method="banco"]').click();
    assert.equal(await page.locator('#simulate-renewal').isDisabled(), true);
    assert.equal(await page.locator('#transfer-pending').isVisible(), true);
    await page.locator('[data-method="tarjeta"]').click();
    assert.equal(await page.locator('#card-terms').isDisabled(), true);
    const active = await page.evaluate(() => fetch('/sandbox-payphone/estado').then(r => r.json()));
    assert.equal(active.active.status, 'reserved');
    assert.equal(active.active.paymentKind, 'button');
    const denied = await page.evaluate(() => fetch('/sandbox-payphone/cerrar-sin-pago', { method: 'POST', headers: { 'X-Local-Sandbox': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ noCardDataOrPayment: false }) }).then(r => r.status));
    assert.equal(denied, 400);
    page.once('dialog', dialog => dialog.accept());
    const closed = page.waitForResponse(response => response.url().endsWith('/sandbox-payphone/cerrar-sin-pago'));
    await page.evaluate(() => { window.samePageMarker = 'kept'; });
    await page.getByRole('button', { name: 'Cancelar transacción', exact: true }).click();
    assert.equal((await closed).status(), 200);
    await page.waitForFunction(() => document.querySelector('[data-method="banco"]').getAttribute('aria-selected') === 'true');
    assert.equal(await page.evaluate(() => window.samePageMarker), 'kept');
    assert.equal(await page.locator('[data-monthly]').inputValue(), '12');
    assert.equal(await page.locator('#simulate-renewal').isEnabled(), true);
    const next = await page.evaluate(() => fetch('/sandbox-payphone/estado').then(r => r.json()));
    assert.equal(next.active, null);
    await context.close();
  } finally { await browser.close(); app.server.close(); await once(app.server, 'close'); app.closeStore(); }
});

test('el retorno del botón usa la confirmación del botón, no la de la Cajita', async () => {
  let requestBody, confirmUrl;
  const app = createSandboxServer({ enabled: true, sandboxVerified: true, token: 'fake', storeId: 'fake', dbPath: ':memory:', fetchImpl: async (url, request) => {
    const body = JSON.parse(request.body);
    if (url.endsWith('/Prepare')) {
      requestBody = body;
      return { ok: true, json: async () => ({ payWithCard: 'https://pay.payphonetodoesposible.com/Anonymous/Index?paymentId=demo' }) };
    }
    confirmUrl = url;
    return { status: 200, text: async () => JSON.stringify({ transactionId: body.id, clientTransactionId: body.clientTxId,
      amount: 3450, currency: 'USD', statusCode: 3, transactionStatus: 'Approved' }) };
  } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const port = app.server.address().port;
  try {
    const page = await send(port, '/sandbox-payphone/boton');
    const cookie = page.headers['set-cookie'][0].split(';')[0];
    const headers = { cookie, origin: `http://localhost:${port}`, 'x-local-sandbox': '1' };
    assert.equal((await send(port, '/sandbox-payphone/boton/preparar', { method: 'POST', headers })).status, 200);
    const result = await send(port, `/respuesta-payphone.html?id=42&clientTransactionId=${requestBody.clientTransactionId}`, { headers: { cookie } });
    assert.equal(result.status, 303);
    assert.equal(confirmUrl, 'https://pay.payphonetodoesposible.com/api/button/V2/Confirm');
    assert.equal(JSON.parse((await send(port, '/sandbox-payphone/estado', { headers: { cookie } })).body).active.status, 'approved');
  } finally { app.server.close(); await once(app.server, 'close'); app.closeStore(); }
});

test('el navegador envía el origen al abrir el formulario simulado', async () => {
  const app = createSandboxServer({ enabled: true, sandboxVerified: true, token: 'fake', storeId: 'fake', dbPath: ':memory:',
    fetchImpl: async () => ({ ok: true, json: async () => ({ payWithCard: 'https://pay.payphonetodoesposible.com/Anonymous/Index?paymentId=demo' }) }) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const port = app.server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    let referer;
    await context.route(`http://localhost:${port}/sandbox-payphone/boton`, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'referrer-policy': 'same-origin' } });
    });
    await context.route('https://pay.payphonetodoesposible.com/**', route => {
      referer = route.request().headers().referer;
      return route.fulfill({ status: 200, body: 'Formulario simulado' });
    });
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}/sandbox-payphone/boton`);
    await page.locator('#start').click();
    await page.waitForURL('https://pay.payphonetodoesposible.com/**');
    assert.equal(referer, `http://localhost:${port}/`);
    await context.close();
  } finally { await browser.close(); app.server.close(); await once(app.server, 'close'); app.closeStore(); }
});

test('cancelar una Cajita en prueba conserva cantidad y cambia a transferencia sin recargar', async () => {
  const app = createSandboxServer({ enabled: true, sandboxVerified: true, token: 'fake', storeId: 'fake', dbPath: ':memory:' });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const port = app.server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route('https://cdn.payphonetodoesposible.com/**', route => route.request().url().endsWith('.js')
      ? route.fulfill({ contentType: 'text/javascript', body: "window.PPaymentButtonBox=class { render(id){ document.getElementById(id).textContent='Formulario simulado'; } }" })
      : route.fulfill({ contentType: 'text/css', body: '' }));
    const page = await context.newPage();
    const state = page.waitForResponse(response => response.url().endsWith('/sandbox-payphone/estado'));
    await page.goto(`http://localhost:${port}/renovacion.html`); await state;
    await page.locator('[data-monthly]').fill('12');
    await page.locator('#confirm-plan').click();
    await page.locator('[data-method="tarjeta"]').click();
    await page.locator('#card-terms').check();
    await page.locator('#card-continue').click();
    await page.getByRole('button', { name: 'Cancelar transacción' }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pending-message').isVisible(), false);
    await page.evaluate(() => { window.samePageMarker = 'kept'; });
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Cancelar transacción' }).click();
    await page.waitForFunction(() => document.querySelector('[data-method="banco"]').getAttribute('aria-selected') === 'true');
    assert.equal(await page.evaluate(() => window.samePageMarker), 'kept');
    assert.equal(await page.locator('[data-monthly]').inputValue(), '12');
    assert.equal(await page.locator('#simulate-renewal').isEnabled(), true);
    assert.equal((await page.evaluate(() => fetch('/sandbox-payphone/estado').then(r => r.json()))).active, null);
    await context.close();
  } finally { await browser.close(); app.server.close(); await once(app.server, 'close'); app.closeStore(); }
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
      if (url.startsWith('https://tbc.tributasoft.ec/')) return route.fulfill({ contentType: 'text/html', body: 'Destino simulado' });
      return route.abort();
    });
    const page = await context.newPage();
    await page.clock.install();
    let reservations = 0;
    page.on('request', request => { if (request.url().endsWith('/sandbox-payphone/reservar')) reservations++; });
    const stateResponse = page.waitForResponse(response => response.url().endsWith('/sandbox-payphone/estado'));
    await page.goto(`http://localhost:${port}/renovacion.html`);
    await stateResponse;
    assert.equal(reservations, 0, 'Abrir la página no debe reservar una operación.');
    await page.locator('[data-monthly]').fill('0');
    await page.locator('#confirm-plan').click();
    assert.equal(await page.locator('#payment-card').isVisible(), false);
    await page.locator('[data-monthly]').fill('10');
    await page.locator('#confirm-plan').click();
    await page.locator('[data-method="tarjeta"]').click();
    assert.equal(await page.locator('#local-payphone-status').innerText(), '');
    assert.equal(reservations, 0, 'Sin aceptar términos no debe abrirse la Cajita.');
    await page.locator('#card-terms').check();
    assert.equal(reservations, 0, 'Aceptar términos no debe preparar la Cajita.');
    assert.equal(await page.locator('#card-documents').innerText(), '120');
    assert.equal(await page.locator('#card-total').innerText(), '$34.50');
    await page.locator('#card-modify').click();
    await page.locator('[data-monthly]').fill('12');
    await page.locator('#confirm-plan').click();
    assert.equal(await page.locator('#card-terms').isChecked(), true);
    assert.equal(await page.locator('#card-total').innerText(), '$40.02');
    assert.equal(reservations, 0, 'Modificar antes de continuar no debe reservar.');
    await page.locator('#card-modify').click();
    await page.locator('[data-monthly]').fill('10');
    await page.locator('#confirm-plan').click();
    const reservation = page.waitForResponse(response => response.url().endsWith('/sandbox-payphone/reservar'));
    await page.locator('#card-continue').click();
    const config = await (await reservation).json();
    await page.waitForFunction(() => window.testAmount === 3450);
    assert.equal(await page.getByRole('button', { name: 'Cancelar transacción' }).isVisible(), true);
    assert.equal(await page.locator('#pending-message').isVisible(), false);
    await page.clock.fastForward(61000);
    assert.equal(await page.locator('#pp-button').isVisible(), true);
    assert.equal(await page.locator('#local-payphone-status').innerText(), '');
    await page.locator('[data-method="banco"]').click();
    await page.locator('[data-method="tarjeta"]').click();
    assert.equal(reservations, 1, 'Cambiar de método no debe crear otro intento.');
    assert.equal(await page.locator('[data-monthly]').isDisabled(), true);
    await page.reload();
    await page.getByText('Cancelar transacción', { exact: true }).waitFor({ state: 'attached' });
    assert.equal(await page.locator('[data-monthly]').isDisabled(), false);
    assert.equal(await page.locator('[data-monthly]').inputValue(), '10');
    await page.locator('#confirm-plan').click();
    await page.locator('[data-method="tarjeta"]').click();
    assert.equal(await page.getByRole('button', { name: 'Cancelar transacción' }).isVisible(), true);
    assert.equal(await page.locator('#simulate-renewal').isDisabled(), true);
    await page.goto(`http://localhost:${port}/respuesta-payphone.html?id=42&clientTransactionId=${config.clientTransactionId}`);
    await page.locator('#code-dialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#code-dialog').innerText(), /Email registrado/i);
    await page.locator('#code-dialog [data-close-dialog]').click();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-monthly]').disabled);
    assert.equal(await page.locator('#code-dialog').isVisible(), false);
    assert.match(await page.locator('#transfer-pending strong').innerText(), /aprobado/);
    await page.locator('[data-method="tarjeta"]').click();
    assert.match(await page.locator('#local-payphone-status').innerText(), /fue aprobada/);
    assert.match(await page.locator('#pending-message strong').innerText(), /aprobada/);
    assert.equal(await page.locator('#simulate-renewal').isDisabled(), true);
    await page.getByRole('button', { name: 'Continuar verificación' }).click();
    assert.equal(await page.locator('#code-dialog').isVisible(), true);
    const before = await send(port, '/renovacion.html');
    const sessionCookie = before.headers['set-cookie'][0].split(';')[0];
    const finishHeaders = { cookie: sessionCookie, origin: `http://localhost:${port}`, 'x-local-sandbox': '1' };
    assert.equal((await send(port, '/sandbox-payphone/finalizar', { method: 'POST', headers: finishHeaders, body: JSON.stringify({ code: '000000' }) })).status, 400);
    assert.equal(JSON.parse((await send(port, '/sandbox-payphone/estado', { headers: { cookie: sessionCookie } })).body).active.status, 'approved');
    await page.locator('#email-code').fill('123456');
    await page.locator('#verify-code').click();
    await page.waitForURL('https://tbc.tributasoft.ec/**');
    assert.equal(app.server.listening, true);
    const refreshed = await send(port, '/renovacion.html');
    const cookie = refreshed.headers['set-cookie'][0].split(';')[0];
    const state = JSON.parse((await send(port, '/sandbox-payphone/estado', { headers: { cookie } })).body);
    assert.equal(state.active, null);
    const freshContext = await browser.newContext({ serviceWorkers: 'block' });
    const freshPage = await freshContext.newPage();
    let freshReservations = 0;
    freshPage.on('request', request => { if (request.url().endsWith('/sandbox-payphone/reservar')) freshReservations++; });
    const freshState = freshPage.waitForResponse(response => response.url().endsWith('/sandbox-payphone/estado'));
    await freshPage.goto(`http://localhost:${port}/renovacion.html`);
    assert.equal((await (await freshState).json()).active, null, 'Una sesión nueva no recupera la orden finalizada.');
    assert.equal(await freshPage.locator('#code-dialog').isVisible(), false);
    await freshPage.locator('#confirm-plan').click();
    await freshPage.locator('[data-method="tarjeta"]').click();
    assert.equal(await freshPage.locator('#pending-message').isVisible(), false);
    assert.equal(await freshPage.getByRole('button', { name: 'Continuar verificación' }).count(), 0);
    assert.equal(await freshPage.locator('#card-terms').isEnabled(), true);
    assert.equal(freshReservations, 0, 'Una sesión nueva no debe crear una orden al abrir tarjeta.');
    await freshContext.close();
    const next = await send(port, '/sandbox-payphone/reservar', { method: 'POST', headers: { cookie, origin: `http://localhost:${port}`, 'x-local-sandbox': '1' }, body: JSON.stringify({ monthly: 1, termsAccepted: true }) });
    assert.equal(next.status, 200, 'Una renovación finalizada permite una nueva reserva.');
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
