// Preparación aislada: el transporte debe ser inyectado por el servidor de prueba.
export async function prepareRedirect({ monthly, transactionId, origin, storeId, transport, calculateQuote }) {
  if (!Number.isSafeInteger(monthly) || monthly < 1 || monthly > 10000 ||
      !/^local-[0-9a-f-]{36}$/.test(transactionId) || typeof transport !== 'function' ||
      typeof calculateQuote !== 'function' || typeof storeId !== 'string' || !storeId.trim()) {
    throw new Error('Datos de renovación inválidos.');
  }
  const base = new URL(origin);
  if (!(base.protocol === 'https:' && /^[a-z0-9-]+\.use\.devtunnels\.ms$/.test(base.hostname)) &&
      !(base.protocol === 'http:' && base.hostname === 'localhost')) throw new Error('Origen no permitido.');
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Origen no permitido.');
  const quote = calculateQuote(monthly);
  const responseUrl = new URL('/respuesta-payphone.html', base);
  const cancellationUrl = new URL('/cancelacion-payphone.html', base);
  cancellationUrl.searchParams.set('orden', transactionId);
  const result = await transport({ amount: quote.totalCents, amountWithoutTax: 0,
    amountWithTax: quote.baseCents, tax: quote.taxCents, currency: 'USD',
    clientTransactionId: transactionId, storeId, responseUrl: responseUrl.href,
    cancellationUrl: cancellationUrl.href, reference: 'Renovación TributaSoft' });
  let url;
  try { url = new URL(result?.payWithCard); } catch { throw new Error('Respuesta de PayPhone inválida.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'pay.payphonetodoesposible.com' || url.username || url.password) {
    throw new Error('Dirección de pago no permitida.');
  }
  return url.href;
}
