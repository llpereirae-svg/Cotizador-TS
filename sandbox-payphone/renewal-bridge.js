const status = document.querySelector('#local-payphone-status');
const field = document.querySelector('[data-monthly]');
const terms = document.querySelector('#card-terms');
let ready = false;
let wantsCard = false;
let started = false;

document.addEventListener('paymentmethodchange', event => {
  wantsCard = event.detail?.method === 'tarjeta';
  if (wantsCard) void prepareCajita();
});

function protectOperation(monthly, paymentState) {
  if (monthly) {
    field.value = String(monthly);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.querySelector('#simulate-pending').click();
  if (paymentState === 'approved') {
    document.querySelector('#pending-message strong').textContent = 'Operación de prueba aprobada';
    document.querySelector('#pending-message p').textContent = 'Esta orden ficticia ya se completó y permanece bloqueada para evitar duplicados.';
  } else {
    document.querySelector('#pending-message p').textContent = 'Hay una operación de prueba activa. Confirma su estado antes de intentar otro método.';
  }
  for (const selector of ['[data-monthly]', '[data-increase]', '[data-decrease]']) document.querySelector(selector).disabled = true;
  terms.disabled = true;
}
try {
  const response = await fetch('/sandbox-payphone/estado');
  if (!response.ok) throw new Error();
  const { active } = await response.json();
  if (active) {
    protectOperation(active.monthly, active.status);
    status.textContent = active.status === 'approved'
      ? 'La orden de prueba fue aprobada y permanece bloqueada para evitar duplicados.'
      : 'Ya existe una operación de prueba. Confirma su estado antes de reintentar.';
    if (active.status === 'approved') document.dispatchEvent(new CustomEvent('sandbox-payment-approved'));
  } else {
    ready = true;
    if (wantsCard) void prepareCajita();
  }
} catch {
  status.textContent = 'No se pudo comprobar el estado de la operación. No inicies otro pago.';
}

async function prepareCajita() {
  if (!ready || !wantsCard || started) return;
  if (!terms.checked) { status.textContent = 'Acepta los términos antes de abrir la Cajita.'; return; }
  const monthly = Number(field.value);
  if (!Number.isSafeInteger(monthly) || monthly < 1 || monthly > 10000) {
    status.textContent = 'Ingresa entre 1 y 10,000 documentos mensuales para la prueba.';
    return;
  }
  started = true;
  protectOperation(monthly);
  status.textContent = 'Preparando la operación de prueba…';
  try {
    const response = await fetch('/sandbox-payphone/reservar', { method: 'POST',
      headers: { 'X-Local-Sandbox': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ monthly, termsAccepted: true }) });
    if (!response.ok) throw new Error();
    const config = await response.json();
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://cdn.payphonetodoesposible.com/box/v2.0/payphone-payment-box.css';
    document.head.append(css);
    const sdk = document.createElement('script');
    sdk.type = 'module'; sdk.src = 'https://cdn.payphonetodoesposible.com/box/v2.0/payphone-payment-box.js';
    await new Promise((resolve, reject) => { sdk.onload = resolve; sdk.onerror = reject; document.head.append(sdk); });
    if (typeof window.PPaymentButtonBox !== 'function') throw new Error();
    new window.PPaymentButtonBox(config).render('pp-button');
    status.textContent = 'Cajita de prueba preparada. El resultado se confirmará en el servidor.';
    setTimeout(() => {
      document.querySelector('#pp-button').hidden = true;
      status.textContent = 'La espera superó un minuto. Verifica el estado con PayPhone antes de reintentar; esto no confirma una cancelación.';
    }, 60000);
  } catch {
    status.textContent = 'No se pudo preparar la Cajita. Confirma el estado de la operación antes de reintentar.';
  }
}
