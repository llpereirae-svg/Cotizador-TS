import {
  requiredText,
  positiveInteger,
  buildConfirmBody,
  evaluatePayphoneConfirmation
} from './protocol.mjs';

// La URL documentada NO identifica el ambiente de la credencial: el modo se
// selecciona en la aplicación configurada en la cuenta de Payphone.
export const PAYPHONE_CONFIRM_URL = 'https://paymentbox.payphonetodoesposible.com/api/confirm';
export const PAYPHONE_BUTTON_CONFIRM_URL = 'https://pay.payphonetodoesposible.com/api/button/V2/Confirm';

function pending(reason) {
  return { status: 'pending', reason };
}

// Un resultado que llegue después del límite se ignora. El almacén debe
// conservar el intento pendiente para reconciliarlo; jamás implica cancelación.
async function beforeDeadline(operation, deadline, onTimeout = () => {}) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    onTimeout();
    return { kind: 'timeout' };
  }

  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation).then(value => ({ kind: 'ok', value }), () => ({ kind: 'error' })),
      new Promise(resolve => {
        timer = setTimeout(() => {
          onTimeout();
          resolve({ kind: 'timeout' });
        }, remaining);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adaptador de la solicitud oficial. Sin transporte ni almacenamiento por
 * defecto: no inicia una conexión por sí mismo.
 *
 * La selección de modo y la declaración de verificación son medidas operativas;
 * no prueban que el token sea de pruebas. Se requiere una implementación
 * backend autenticada, un almacén transaccional y verificación independiente
 * de la configuración de Payphone antes de conectar un transporte real.
 */
export function createPayphoneTestConfirmation({
  mode,
  sandboxVerified,
  token,
  transport,
  attemptStore,
  confirmUrl = PAYPHONE_CONFIRM_URL,
  timeoutMs = 60000
} = {}) {
  if (mode !== 'test' || sandboxVerified !== true) {
    throw new Error('La confirmación requiere modo de pruebas y verificación explícita del ambiente.');
  }
  const bearerToken = requiredText(token, 'token');
  if (/[\r\n]/.test(bearerToken)) throw new TypeError('Token inválido.');
  if (typeof transport !== 'function') throw new TypeError('Se requiere un transporte inyectado.');
  if (![PAYPHONE_CONFIRM_URL, PAYPHONE_BUTTON_CONFIRM_URL].includes(confirmUrl)) throw new TypeError('Destino de confirmación inválido.');
  if (!attemptStore || typeof attemptStore.claim !== 'function' || typeof attemptStore.record !== 'function') {
    throw new TypeError('Se requiere un almacén de intentos inyectado.');
  }
  const waitMs = positiveInteger(timeoutMs, 'timeoutMs');
  if (waitMs > 60000) throw new RangeError('timeoutMs no puede superar un minuto.');
  const locallyClaimed = new Set();
  const locallyClaimedRenewals = new Set();

  return {
    /**
     * order debe proceder de una orden obtenida y autorizada en el backend,
     * no de importes o identidades que envíe libremente el navegador.
     */
    async confirm(input = {}) {
      let body;
      let renewalRef;
      let amountCents;
      let currency;
      try {
        if (!input || typeof input !== 'object' || Array.isArray(input)) return pending('invalid_order');
        const { id, clientTransactionId, order } = input;
        body = buildConfirmBody({ id, clientTransactionId });
        if (!order || typeof order !== 'object') return pending('invalid_order');
        renewalRef = requiredText(order.renewalRef, 'renewalRef');
        amountCents = positiveInteger(order.amountCents, 'amountCents');
        currency = requiredText(order.currency, 'currency');
        if (requiredText(order.clientTransactionId, 'order.clientTransactionId') !== body.clientTxId) {
          return pending('invalid_order');
        }
      } catch {
        return pending('invalid_order');
      }

      // Evita dos llamadas simultáneas o reintentos automáticos en esta
      // instancia. El almacén inyectado debe hacerlo de forma persistente y
      // atómica entre procesos, incluso ante timeout o fallo de persistencia.
      if (locallyClaimed.has(body.clientTxId) || locallyClaimedRenewals.has(renewalRef)) {
        return pending('already_claimed');
      }
      locallyClaimed.add(body.clientTxId);
      locallyClaimedRenewals.add(renewalRef);
      const deadline = Date.now() + waitMs;
      const attempt = {
        renewalRef,
        clientTransactionId: body.clientTxId,
        providerTransactionId: body.id
      };

      const claimed = await beforeDeadline(() => attemptStore.claim(attempt), deadline);
      if (claimed.kind !== 'ok') return pending('claim_unavailable');
      if (claimed.value === false) {
        // Solo false confirma que esta llamada no adquirió la reserva. Ningún
        // otro intento local puede poseer estas claves mientras están marcadas.
        locallyClaimed.delete(body.clientTxId);
        locallyClaimedRenewals.delete(renewalRef);
        return pending('already_claimed');
      }
      // Un valor distinto de true o false es ambiguo: conservar el bloqueo.
      if (claimed.value !== true) return pending('claim_unavailable');

      const controller = new AbortController();
      const providerResult = await beforeDeadline(() => transport({
        url: confirmUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + bearerToken
        },
        json: body,
        signal: controller.signal
      }), deadline, () => controller.abort());

      // El claim ya fue persistido; una espera agotada no implica cancelación.
      // Mantener el bloqueo para conciliar sin atribuir el plazo al almacén.
      if (providerResult.kind === 'timeout') return pending('provider_timeout');

      let status = 'pending';
      let reason = 'unresolved';
      if (providerResult.kind === 'ok' &&
          Number.isInteger(providerResult.value?.httpStatus) &&
          providerResult.value.httpStatus >= 200 &&
          providerResult.value.httpStatus < 300) {
        status = evaluatePayphoneConfirmation({
          response: providerResult.value.data,
          id: body.id,
          clientTransactionId: body.clientTxId,
          expectedAmountCents: amountCents,
          currency
        });
        reason = status === 'pending' ? 'unresolved' : 'verified';
      }

      // El claim debe permanecer bloqueado cuando no se conoce el resultado.
      // No se devuelve éxito si la persistencia no confirma la escritura.
      const saved = await beforeDeadline(() => attemptStore.record({ ...attempt, status }), deadline);
      if (saved.kind !== 'ok' || saved.value !== true) return pending('record_unavailable');
      if (status === 'canceled') locallyClaimedRenewals.delete(renewalRef);
      return { status, reason };
    }
  };
}
