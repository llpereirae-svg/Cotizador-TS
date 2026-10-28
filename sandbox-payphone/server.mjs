import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createLocalAttemptStore } from './local-store.mjs';
import { createPayphoneTestConfirmation, PAYPHONE_CONFIRM_URL } from '../integrations/payphone/confirmation-client.mjs';
import { buildSandboxCajitaConfig } from './cajita-config.mjs';
import { calculateQuote } from '../assets/quote.js';

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = readFileSync(new URL('./test-page.html', import.meta.url), 'utf8');
const browser = readFileSync(new URL('./test-page.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('./renewal-bridge.js', import.meta.url), 'utf8');

/** Crea un servidor para prueba local y no lo inicia; el ambiente es declarado por el operador. */
export function createSandboxServer({ enabled, sandboxVerified, token, storeId, dbPath, fetchImpl = globalThis.fetch } = {}) {
  if (enabled !== true || sandboxVerified !== true || !token?.trim() || !storeId?.trim()) {
    throw new Error('Se requieren activación explícita y credenciales de prueba verificadas.');
  }
  if (typeof fetchImpl !== 'function' || typeof dbPath !== 'string') throw new Error('Faltan dependencias locales.');
  const store = createLocalAttemptStore({ filename: dbPath });
  const session = store.session(randomBytes(32).toString('hex'));
  const transport = async ({ url, method, headers, json, signal }) => {
    if (url !== PAYPHONE_CONFIRM_URL || method !== 'POST') throw new Error('Destino no permitido.');
    const response = await fetchImpl(url, { method, headers, body: JSON.stringify(json), signal, redirect: 'error' });
    const responseText = await response.text();
    if (responseText.length > 65536) throw new Error('Respuesta demasiado grande.');
    let data = null;
    try { data = JSON.parse(responseText); } catch { /* estado indeterminado */ }
    return { httpStatus: response.status, data };
  };
  const client = createPayphoneTestConfirmation({ mode: 'test', sandboxVerified: true, token, transport, attemptStore: store });
  const html = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const port = server.address()?.port;
    const host = req.headers.host;
    if (host !== `localhost:${port}` || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
      return html(res, 403, 'Acceso local requerido.');
    }
    const origin = `http://localhost:${port}`;
    const url = new URL(req.url, origin);
    const authorized = (req.headers.cookie || '').split(';').some(value => value.trim() === `pp_session=${session}`);
    if (req.method === 'GET' && url.pathname === '/sandbox-payphone') {
      res.setHeader('Set-Cookie', `pp_session=${session}; HttpOnly; SameSite=Lax; Path=/`);
      return html(res, 200, page);
    }
    if (req.method === 'GET' && url.pathname === '/renovacion.html') {
      res.setHeader('Set-Cookie', `pp_session=${session}; HttpOnly; SameSite=Lax; Path=/`);
      const renewal = readFileSync(new URL('../renovacion.html', import.meta.url), 'utf8');
      const marker = '<div class="card-placeholder" id="payphone-container">';
      if (!renewal.includes(marker)) return html(res, 503, 'La vista de renovación cambió; revisa el adaptador local.');
      const patched = renewal.replace(marker, `<p>Ensayo local con credenciales de prueba. La renovación real no se realiza.</p>
        <p id="local-payphone-status" role="status" aria-live="polite"></p><div id="pp-button"></div>${marker}`)
        .replace('</head>', '<style>#payphone-container,#simulate-pending,#simulate-cancelled{display:none!important}</style></head>')
        .replace('</body>', '<script type="module" src="/sandbox-payphone/renewal-bridge.js"></script></body>');
      return html(res, 200, patched);
    }
    if (!authorized) return html(res, 403, 'Abre primero la página de prueba en este navegador.');
    if (req.method === 'GET' && url.pathname === '/sandbox-payphone/test-page.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return res.end(browser);
    }
    if (req.method === 'GET' && url.pathname === '/sandbox-payphone/renewal-bridge.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return res.end(bridge);
    }
    const staticFiles = {
      '/renovacion.js': ['../renovacion.js', 'text/javascript'],
      '/renovacion-mock.js': ['../renovacion-mock.js', 'text/javascript'],
      '/renovacion.css': ['../renovacion.css', 'text/css'],
      '/assets/base.css': ['../assets/base.css', 'text/css'],
      '/assets/quote.js': ['../assets/quote.js', 'text/javascript'],
      '/assets/tributasoft-logo.png': ['../assets/tributasoft-logo.png', 'image/png'],
      '/assets/payphone-logo.svg': ['../assets/payphone-logo.svg', 'image/svg+xml'],
      '/assets/avenida.otf': ['../assets/avenida.otf', 'font/otf'],
      '/assets/fonts/inter-latin.woff2': ['../assets/fonts/inter-latin.woff2', 'font/woff2'],
      '/assets/fonts/dm-sans-latin.woff2': ['../assets/fonts/dm-sans-latin.woff2', 'font/woff2'],
      '/assets/fonts/lobster-latin.woff2': ['../assets/fonts/lobster-latin.woff2', 'font/woff2']
    };
    if (req.method === 'GET' && staticFiles[url.pathname]) {
      const [file, type] = staticFiles[url.pathname];
      res.writeHead(200, { 'Content-Type': type }); return res.end(readFileSync(new URL(file, import.meta.url)));
    }
    if (req.method === 'GET' && url.pathname === '/sandbox-payphone/estado') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ active: store.active('demo-unica') }));
    }
    if (req.method === 'POST' && url.pathname === '/sandbox-payphone/reservar') {
      if (req.headers.origin !== origin || req.headers['x-local-sandbox'] !== '1') return html(res, 403, 'Origen no autorizado.');
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 256) return html(res, 413, 'Solicitud demasiado grande.'); }
      let monthly, termsAccepted;
      try { ({ monthly, termsAccepted } = JSON.parse(body)); } catch { return html(res, 400, 'Cantidad inválida.'); }
      if (termsAccepted !== true) return html(res, 400, 'Acepta los términos antes de continuar.');
      if (!Number.isSafeInteger(monthly) || monthly < 1 || monthly > 10000) return html(res, 400, 'Cantidad inválida.');
      const quote = calculateQuote(monthly);
      const clientTransactionId = 'local-' + randomUUID();
      const order = { renewalRef: 'demo-unica', clientTransactionId, amountCents: quote.totalCents, currency: 'USD', monthly };
      if (!store.reserve(order)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Hay un intento existente. Consulta su estado antes de continuar.' }));
      }
      const reservation = { status: 'reserved', clientTransactionId, reference: 'Prueba local TributaSoft',
        currency: 'USD', amount: quote.totalCents, amountWithoutTax: 0, amountWithTax: quote.baseCents, tax: quote.taxCents, service: 0, tip: 0 };
      const config = buildSandboxCajitaConfig({ mode: 'test', sandboxVerified: true, siteOrigin: origin, token, storeId, reservation });
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(config));
    }
    if (req.method === 'GET' && url.pathname === '/respuesta-payphone.html') {
      if (url.searchParams.getAll('id').length !== 1 || url.searchParams.getAll('clientTransactionId').length !== 1) {
        return html(res, 400, 'Retorno inválido; la operación queda pendiente.');
      }
      const id = url.searchParams.get('id');
      const clientTransactionId = url.searchParams.get('clientTransactionId');
      if (!/^\d+$/.test(id) || !/^local-[0-9a-f-]{36}$/.test(clientTransactionId)) {
        return html(res, 400, 'Retorno inválido; la operación queda pendiente.');
      }
      const order = store.get(clientTransactionId);
      if (!order) return html(res, 404, 'Orden no encontrada; no se confirmó ningún pago.');
      if (order.status === 'approved') { res.writeHead(303, { Location: '/renovacion.html' }); return res.end(); }
      if (order.status !== 'reserved') {
        return html(res, 200, `Estado de la operación de prueba: ${escapeHtml(order.status)}. No reintentes si sigue pendiente.`);
      }
      const result = await client.confirm({ id, clientTransactionId, order });
      if (result.status === 'approved') { res.writeHead(303, { Location: '/renovacion.html' }); return res.end(); }
      return html(res, 200, `Estado de la operación de prueba: ${escapeHtml(result.status)}. Si está pendiente, verifica el resultado con PayPhone antes de reintentar.`);
    }
    return html(res, 404, 'Página no encontrada.');
  });
  return { server, closeStore: () => store.close() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.PAYPHONE_SANDBOX_ENABLED !== '1' || process.env.PAYPHONE_SANDBOX_VERIFIED !== '1') {
    throw new Error('Activa y verifica explícitamente el ambiente de prueba antes de iniciar.');
  }
  const folder = join(tmpdir(), 'tributasoft-payphone-local');
  mkdirSync(folder, { recursive: true });
  const app = createSandboxServer({ enabled: true, sandboxVerified: true,
    token: process.env.PAYPHONE_TEST_TOKEN, storeId: process.env.PAYPHONE_TEST_STORE_ID,
    dbPath: join(folder, 'attempts.sqlite') });
  app.server.listen(8131, '127.0.0.1', () => process.stdout.write('Servidor de pruebas activo solo en localhost.\n'));
  const stop = () => app.server.close(() => { app.closeStore(); process.exit(0); });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
