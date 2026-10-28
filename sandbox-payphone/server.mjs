import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createLocalAttemptStore } from './local-store.mjs';
import { createPayphoneTestConfirmation, PAYPHONE_CONFIRM_URL, PAYPHONE_BUTTON_CONFIRM_URL } from '../integrations/payphone/confirmation-client.mjs';
import { buildSandboxCajitaConfig } from './cajita-config.mjs';
import { prepareRedirect } from './redirect-prepare.mjs';
import { calculateQuote } from '../assets/quote.js';

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = readFileSync(new URL('./test-page.html', import.meta.url), 'utf8');
const browser = readFileSync(new URL('./test-page.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('./renewal-bridge.js', import.meta.url), 'utf8');

/** Crea un servidor para prueba local y no lo inicia; el ambiente es declarado por el operador. */
export function createSandboxServer({ enabled, sandboxVerified, token, storeId, dbPath, tunnelOrigin = '', fetchImpl = globalThis.fetch, logger = () => {} } = {}) {
  if (enabled !== true || sandboxVerified !== true || !token?.trim() || !storeId?.trim()) {
    throw new Error('Se requieren activación explícita y credenciales de prueba verificadas.');
  }
  if (typeof fetchImpl !== 'function' || typeof dbPath !== 'string') throw new Error('Faltan dependencias locales.');
  const logEvent = event => { try { logger(event); } catch { /* el registro no debe alterar la confirmación */ } };
  if (tunnelOrigin && !/^https:\/\/[a-z0-9-]+\.use\.devtunnels\.ms$/.test(tunnelOrigin)) {
    throw new Error('El origen del túnel privado no es válido.');
  }
  const store = createLocalAttemptStore({ filename: dbPath });
  const session = store.session(randomBytes(32).toString('hex'));
  const transport = async ({ url, method, headers, json, signal }) => {
    if (![PAYPHONE_CONFIRM_URL, PAYPHONE_BUTTON_CONFIRM_URL].includes(url) || method !== 'POST') throw new Error('Destino no permitido.');
    const response = await fetchImpl(url, { method, headers, body: JSON.stringify(json), signal, redirect: 'error' });
    const responseText = await response.text();
    if (responseText.length > 65536) throw new Error('Respuesta demasiado grande.');
    let data = null;
    try { data = JSON.parse(responseText); } catch { /* estado indeterminado */ }
    return { httpStatus: response.status, data };
  };
  const client = createPayphoneTestConfirmation({ mode: 'test', sandboxVerified: true, token, transport, attemptStore: store });
  const buttonClient = createPayphoneTestConfirmation({ mode: 'test', sandboxVerified: true, token, transport, attemptStore: store, confirmUrl: PAYPHONE_BUTTON_CONFIRM_URL });
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
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(303, { Location: '/renovacion.html' }); return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/sandbox-payphone') {
      res.setHeader('Set-Cookie', `pp_session=${session}; HttpOnly; SameSite=Lax; Path=/`);
      return html(res, 200, page);
    }
    if (req.method === 'GET' && url.pathname === '/renovacion.html') {
      res.setHeader('Set-Cookie', `pp_session=${session}; HttpOnly; SameSite=Lax; Path=/`);
      const renewal = readFileSync(new URL('../renovacion.html', import.meta.url), 'utf8');
      const marker = '<div class="card-placeholder" id="payphone-container" hidden>';
      if (!renewal.includes(marker)) return html(res, 503, 'La vista de renovación cambió; revisa el adaptador local.');
      const patched = renewal.replace(marker, `<p id="local-payphone-status" role="status" aria-live="polite"></p><div id="pp-button"></div>${marker}`)
        .replace('</head>', '<style>#payphone-container,#simulate-pending,#simulate-cancelled{display:none!important}</style></head>')
        .replace('</body>', '<script type="module" src="/sandbox-payphone/renewal-bridge.js"></script></body>');
      return html(res, 200, patched);
    }
    if (req.method === 'GET' && url.pathname === '/sandbox-payphone/boton') {
      res.setHeader('Referrer-Policy', 'origin-when-cross-origin');
      res.setHeader('Set-Cookie', `pp_session=${session}; HttpOnly; SameSite=Lax; Path=/`);
      return html(res, 200, `<!doctype html><html lang="es"><meta name="referrer" content="origin-when-cross-origin"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba de redirección</title><body><h1>Prueba del botón PayPhone</h1><p>Se creará una orden de prueba de 10 documentos mensuales. Usa únicamente credenciales de prueba.</p><button id="start">Abrir PayPhone</button><p id="message" role="status"></p><script src="/sandbox-payphone/boton.js"></script></body></html>`);
    }
    if (!authorized) return html(res, 403, 'Abre primero la página de prueba en este navegador.');
    if (req.method === 'GET' && url.pathname === '/sandbox-payphone/boton.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return res.end(`document.querySelector('#start').onclick=async function(){this.disabled=true;const m=document.querySelector('#message');m.textContent='Preparando…';try{const r=await fetch('/sandbox-payphone/boton/preparar',{method:'POST',headers:{'X-Local-Sandbox':'1'}});if(!r.ok)throw Error();const d=await r.json();location.assign(d.url)}catch{m.textContent='No se pudo preparar el pago. Verifica el estado antes de reintentar.'}}`);
    }
    if (req.method === 'POST' && url.pathname === '/sandbox-payphone/boton/preparar') {
      if (![origin, ...(tunnelOrigin ? [tunnelOrigin] : [])].includes(req.headers.origin) || req.headers['x-local-sandbox'] !== '1') return html(res, 403, 'Origen no autorizado.');
      const monthly = 10, quote = calculateQuote(monthly), clientTransactionId = 'local-' + randomUUID();
      if (!store.reserve({ renewalRef: 'demo-unica', clientTransactionId, amountCents: quote.totalCents, currency: 'USD', monthly, paymentKind: 'button' })) { logEvent('boton_reserva_rechazada'); return html(res, 409, 'Existe una operación activa.'); }
      logEvent('boton_reserva_creada');
      try {
        const paymentUrl = await prepareRedirect({ monthly, transactionId: clientTransactionId, origin: tunnelOrigin || origin, storeId, calculateQuote,
          transport: async payload => {
            const response = await fetchImpl('https://pay.payphonetodoesposible.com/api/button/Prepare', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Referer: `${tunnelOrigin || origin}/` }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(30000) });
            if (!response.ok) { logEvent(`boton_proveedor_http_${Number(response.status) || 0}`); throw new Error('Preparación no confirmada.'); }
            return response.json();
          } });
        logEvent('boton_enlace_preparado');
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ url: paymentUrl }));
      } catch { logEvent('boton_preparacion_no_confirmada'); return html(res, 502, 'Preparación incierta; verifica antes de reintentar.'); }
    }
    if (req.method === 'GET' && url.pathname === '/cancelacion-payphone.html') {
      const orderId = url.searchParams.get('orden');
      const order = orderId && /^local-[0-9a-f-]{36}$/.test(orderId) ? store.get(orderId) : null;
      if (!order || order.paymentKind !== 'button') return html(res, 400, 'No se pudo identificar la orden.');
      res.writeHead(303, { Location: '/renovacion.html?regreso=boton' }); return res.end();
    }
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
      const canceledId = url.searchParams.get('cancelada');
      const canceledOrder = canceledId && /^local-[0-9a-f-]{36}$/.test(canceledId) ? store.get(canceledId) : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ active: store.active('demo-unica'), canceled: canceledOrder?.status === 'canceled' }));
    }
    if (req.method === 'POST' && url.pathname === '/sandbox-payphone/reservar') {
      if (![origin, ...(tunnelOrigin ? [tunnelOrigin] : [])].includes(req.headers.origin) || req.headers['x-local-sandbox'] !== '1') return html(res, 403, 'Origen no autorizado.');
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
        logEvent('reserva_rechazada_operacion_activa');
        res.writeHead(409, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Hay un intento existente. Consulta su estado antes de continuar.' }));
      }
      const reservation = { status: 'reserved', clientTransactionId, reference: 'Prueba local TributaSoft',
        currency: 'USD', amount: quote.totalCents, amountWithoutTax: 0, amountWithTax: quote.baseCents, tax: quote.taxCents, service: 0, tip: 0 };
      const config = buildSandboxCajitaConfig({ mode: 'test', sandboxVerified: true, siteOrigin: origin, token, storeId, reservation });
      logEvent('reserva_creada');
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(config));
    }
    if (req.method === 'POST' && url.pathname === '/sandbox-payphone/finalizar') {
      if (![origin, ...(tunnelOrigin ? [tunnelOrigin] : [])].includes(req.headers.origin) || req.headers['x-local-sandbox'] !== '1') return html(res, 403, 'Origen no autorizado.');
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 128) return html(res, 413, 'Solicitud demasiado grande.'); }
      let code;
      try { ({ code } = JSON.parse(body)); } catch { return html(res, 400, 'Código inválido.'); }
      if (code !== '123456') return html(res, 400, 'Código inválido.');
      if (!store.finalizeApproved('demo-unica')) return html(res, 409, 'No hay un pago aprobado pendiente de finalizar.');
      logEvent('prueba_aprobada_finalizada');
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ status: 'simulado' }));
    }
    if (req.method === 'POST' && url.pathname === '/sandbox-payphone/cerrar-sin-pago') {
      if (![origin, ...(tunnelOrigin ? [tunnelOrigin] : [])].includes(req.headers.origin) || req.headers['x-local-sandbox'] !== '1') return html(res, 403, 'Origen no autorizado.');
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 128) return html(res, 413, 'Solicitud demasiado grande.'); }
      let attested;
      try { ({ noCardDataOrPayment: attested } = JSON.parse(body)); } catch { return html(res, 400, 'Declaración inválida.'); }
      if (attested !== true) return html(res, 400, 'Se requiere una declaración explícita.');
      const candidate = store.recoveryCandidate('demo-unica');
      const order = candidate && store.get(candidate.clientTransactionId);
      if (!candidate || candidate.status !== 'reserved' || candidate.providerTransactionId !== null || order?.paymentKind !== 'button') {
        return html(res, 409, 'El estado requiere revisión.');
      }
      if (!store.closeManually({ clientTransactionId: candidate.clientTransactionId, attestation: 'not_submitted' })) return html(res, 409, 'El estado cambió; verifica la operación.');
      logEvent('boton_cierre_manual_sin_pago');
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ closed: true }));
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
      logEvent('retorno_recibido');
      if (!order) return html(res, 404, 'Orden no encontrada; no se confirmó ningún pago.');
      if (order.status === 'approved') { res.writeHead(303, { Location: '/renovacion.html?pago=aprobado' }); return res.end(); }
      if (order.status !== 'reserved') {
        return html(res, 200, `Estado de la operación de prueba: ${escapeHtml(order.status)}. No reintentes si sigue pendiente.`);
      }
      logEvent('confirmacion_iniciada');
      const result = await (order.paymentKind === 'button' ? buttonClient : client).confirm({ id, clientTransactionId, order });
      const pendingReasons = new Set(['already_claimed', 'claim_unavailable', 'invalid_order', 'provider_timeout', 'record_unavailable', 'unresolved']);
      logEvent(result.status === 'approved' ? 'confirmacion_aprobada' : result.status === 'canceled' ? 'confirmacion_cancelada' : `confirmacion_pendiente_${pendingReasons.has(result.reason) ? result.reason : 'desconocida'}`);
      if (result.status === 'approved') { res.writeHead(303, { Location: '/renovacion.html?pago=aprobado' }); return res.end(); }
      if (result.status === 'canceled') { res.writeHead(303, { Location: '/renovacion.html?cancelada=' + encodeURIComponent(clientTransactionId) }); return res.end(); }
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
  const logger = event => appendFileSync(join(folder, 'eventos.log'), `${new Date().toISOString()} ${event}\n`, { encoding: 'utf8', mode: 0o600 });
  const app = createSandboxServer({ enabled: true, sandboxVerified: true,
    token: process.env.PAYPHONE_TEST_TOKEN, storeId: process.env.PAYPHONE_TEST_STORE_ID,
    dbPath: join(folder, 'attempts.sqlite'), tunnelOrigin: process.env.PAYPHONE_TEST_TUNNEL_ORIGIN || '', logger });
  app.server.listen(8131, '127.0.0.1', () => process.stdout.write('Servidor de pruebas activo solo en localhost.\n'));
  const stop = () => app.server.close(() => { app.closeStore(); process.exit(0); });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
