/** Conversión y comparación del contrato público de confirmación de Payphone. */

export function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(label + ' debe ser texto no vacío.');
  }
  return value.trim();
}

export function positiveInteger(value, label) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(label + ' debe ser un entero positivo.');
  }
  return number;
}

/** Cuerpo documentado por Payphone para la solicitud de confirmación. */
export function buildConfirmBody({ id, clientTransactionId }) {
  return {
    id: positiveInteger(id, 'id'),
    clientTxId: requiredText(clientTransactionId, 'clientTransactionId')
  };
}

/** Una respuesta incongruente o con estado desconocido nunca se aprueba. */
export function evaluatePayphoneConfirmation({ response, id, clientTransactionId, expectedAmountCents, currency }) {
  const expectedId = positiveInteger(id, 'id');
  const expectedClientId = requiredText(clientTransactionId, 'clientTransactionId');
  const amount = positiveInteger(expectedAmountCents, 'expectedAmountCents');
  const expectedCurrency = requiredText(currency, 'currency');

  if (!response || typeof response !== 'object' ||
      response.transactionId !== expectedId ||
      response.clientTransactionId !== expectedClientId ||
      response.amount !== amount ||
      response.currency !== expectedCurrency) {
    return 'pending';
  }
  if (response.statusCode === 3 && response.transactionStatus === 'Approved') return 'approved';
  if (response.statusCode === 2 && response.transactionStatus === 'Canceled') return 'canceled';
  return 'pending';
}
