/**
 * Construye la configuración de la Cajita para un futuro ensayo local.
 * No importa el SDK, no crea una Cajita y no realiza solicitudes.
 * La reserva, identidad, importe y estado de la transacción pertenecen al backend.
 */

function text(value, name, maxLength = Infinity) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new TypeError(`${name} debe ser texto válido.`);
  }
  return value.trim();
}

function cents(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} debe ser un entero no negativo en centavos.`);
  }
  return value;
}

function localOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('Origen local inválido.'); }
  if (!['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('Solo se admite un origen local para esta preparación.');
  }
  return url.origin;
}

/** Estos controles no verifican el ambiente efectivo de la cuenta de PayPhone. */
export function assertSandboxContext({ mode, sandboxVerified, siteOrigin, token, storeId } = {}) {
  if (mode !== 'test' || sandboxVerified !== true) {
    throw new Error('La preparación requiere ambiente de prueba verificado por el responsable.');
  }
  localOrigin(siteOrigin);
  const paymentToken = text(token, 'token');
  if (/[\r\n]/.test(paymentToken)) throw new TypeError('Token inválido.');
  text(storeId, 'storeId');
}

/**
 * Recibe una reserva previamente creada por el backend. Los indicadores de
 * entorno y estado son condiciones de integración, no pruebas de seguridad:
 * no verifican la cuenta de Payphone ni sustituyen una reserva persistente.
 * El token resultante será visible para el navegador al usar la Cajita.
 */
export function buildSandboxCajitaConfig({ mode, sandboxVerified, siteOrigin, token, storeId, reservation } = {}) {
  assertSandboxContext({ mode, sandboxVerified, siteOrigin, token, storeId });
  const paymentToken = text(token, 'token');
  const paymentStore = text(storeId, 'storeId');
  if (!reservation || typeof reservation !== 'object' || Array.isArray(reservation) || reservation.status !== 'reserved') {
    throw new TypeError('Se requiere una reserva previa del backend.');
  }

  const clientTransactionId = text(reservation.clientTransactionId, 'clientTransactionId', 50);
  const reference = text(reservation.reference, 'reference', 100);
  const currency = text(reservation.currency, 'currency');
  if (currency !== 'USD') throw new TypeError('La moneda debe ser USD para esta vista.');

  const amount = cents(reservation.amount, 'amount');
  const amountWithoutTax = cents(reservation.amountWithoutTax, 'amountWithoutTax');
  const amountWithTax = cents(reservation.amountWithTax, 'amountWithTax');
  const tax = cents(reservation.tax, 'tax');
  const service = cents(reservation.service, 'service');
  const tip = cents(reservation.tip, 'tip');
  const sum = amountWithoutTax + amountWithTax + tax + service + tip;
  if (amount === 0 || !Number.isSafeInteger(sum) || sum !== amount) {
    throw new TypeError('El total no coincide con el desglose de la reserva.');
  }

  return { token: paymentToken, storeId: paymentStore, clientTransactionId, reference,
    currency, amount, amountWithoutTax, amountWithTax, tax, service, tip, lang: 'es' };
}
