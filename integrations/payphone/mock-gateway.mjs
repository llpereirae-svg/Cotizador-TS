/**
 * Simulación local de la respuesta de la Cajita de Payphone.
 * NO conecta con Payphone. Solo para pruebas y prototipos.
 */
import {
  requiredText,
  positiveInteger,
  buildConfirmBody,
  evaluatePayphoneConfirmation as evaluateMockConfirmation
} from './protocol.mjs';

export { buildConfirmBody, evaluateMockConfirmation };
function snapshot(attempt) {
  return {
    renewalRef: attempt.renewalRef,
    clientTransactionId: attempt.clientTransactionId,
    amountCents: attempt.amountCents,
    currency: attempt.currency,
    status: attempt.status,
    providerTransactionId: attempt.providerTransactionId
  };
}

/**
 * Estados y bloqueo por renovación simulados en memoria.
 * La creación, la respuesta y los importes deben ser decididos por el backend
 * real; este modelo no sustituye persistencia ni controles de producción.
 */
export function createPayphoneSimulation({ mode } = {}) {
  if (mode !== 'mock') {
    throw new Error('Esta implementación solo admite mode=mock; no conecta con Payphone.');
  }

  const attempts = new Map();
  const currentByRenewal = new Map();

  return {
    createAttempt({ renewalRef, clientTransactionId, amountCents, currency = 'USD' }) {
      const renewal = requiredText(renewalRef, 'renewalRef');
      const clientId = requiredText(clientTransactionId, 'clientTransactionId');
      const amount = positiveInteger(amountCents, 'amountCents');
      const currencyCode = requiredText(currency, 'currency');
      const existing = attempts.get(clientId);

      if (existing) {
        if (existing.renewalRef !== renewal || existing.amountCents !== amount ||
            existing.currency !== currencyCode) {
          throw new Error('El identificador ya pertenece a otra operación.');
        }
        return snapshot(existing);
      }

      const currentId = currentByRenewal.get(renewal);
      if (currentId) throw new Error('Hay una operación pendiente o aprobada para esta renovación.');

      const attempt = {
        renewalRef: renewal,
        clientTransactionId: clientId,
        amountCents: amount,
        currency: currencyCode,
        status: 'pending',
        providerTransactionId: null
      };
      attempts.set(clientId, attempt);
      currentByRenewal.set(renewal, clientId);
      return snapshot(attempt);
    },

    /** La espera agotada solo indica resultado desconocido, nunca cancelación. */
    markTimedOut(clientTransactionId) {
      const clientId = requiredText(clientTransactionId, 'clientTransactionId');
      const attempt = attempts.get(clientId);
      if (!attempt) throw new Error('Operación simulada no encontrada.');
      return snapshot(attempt);
    },

    /**
     * Imita el retorno y comprobación con una respuesta ficticia.
     * Nunca inicia un pago ni llama a una URL.
     */
    applyMockConfirmation({ id, clientTransactionId, response }) {
      const body = buildConfirmBody({ id, clientTransactionId });
      const attempt = attempts.get(body.clientTxId);
      if (!attempt) throw new Error('Operación simulada no encontrada.');
      if (attempt.status !== 'pending') {
        if (attempt.providerTransactionId !== body.id) {
          throw new Error('El identificador de proveedor no coincide con el retorno anterior.');
        }
        return snapshot(attempt);
      }

      const result = evaluateMockConfirmation({
        response,
        id: body.id,
        clientTransactionId: body.clientTxId,
        expectedAmountCents: attempt.amountCents,
        currency: attempt.currency
      });
      if (result !== 'pending') {
        attempt.status = result;
        attempt.providerTransactionId = body.id;
      }
      if (attempt.status === 'canceled') currentByRenewal.delete(attempt.renewalRef);
      return snapshot(attempt);
    },

    getAttempt(clientTransactionId) {
      const clientId = requiredText(clientTransactionId, 'clientTransactionId');
      const attempt = attempts.get(clientId);
      return attempt ? snapshot(attempt) : null;
    }
  };
}
