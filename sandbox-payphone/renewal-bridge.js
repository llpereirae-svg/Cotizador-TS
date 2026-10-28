import { demoRenewalAdapter } from '../renovacion-mock.js?v=20261028-2';

const status = document.querySelector('#local-payphone-status');
const field = document.querySelector('[data-monthly]');
const terms = document.querySelector('#card-terms');
let ready = false;
let wantsCard = false;
let started = false;
let wantsStart = false;

document.addEventListener('paymentmethodchange', event => {
  wantsCard = event.detail?.method === 'tarjeta';
  if (!wantsCard) wantsStart = false;
});
document.addEventListener('sandbox-plan-edit', () => { wantsStart = false; wantsCard = false; });
document.addEventListener('sandbox-open-payphone', () => { wantsCard = true; wantsStart = true; void prepareCajita(); });

function protectOperation(monthly, paymentState) {
  if (monthly) {
    field.value = String(monthly);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.querySelector('#simulate-pending').click();
  if (paymentState === 'approved') {
    document.querySelector('#pending-message strong').textContent = 'Operación de prueba aprobada';
    document.querySelector('#pending-message p').textContent = 'Esta orden ficticia ya se completó y permanece bloqueada para evitar duplicados.';
    document.querySelector('#transfer-pending strong').textContent = 'Pago con tarjeta aprobado';
    document.querySelector('#transfer-pending p').textContent = 'La operación ya fue aprobada. Continúa su verificación para evitar un pago duplicado.';
  } else {
    document.querySelector('#pending-message p').textContent = 'Hay una operación de prueba activa. Confirma su estado antes de intentar otro método.';
  }
  for (const selector of ['[data-monthly]', '[data-increase]', '[data-decrease]']) document.querySelector(selector).disabled = true;
  terms.disabled = true;
}
try {
  const canceledId = new URLSearchParams(location.search).get('cancelada');
  const stateUrl = canceledId ? '/sandbox-payphone/estado?cancelada=' + encodeURIComponent(canceledId) : '/sandbox-payphone/estado';
  const response = await fetch(stateUrl);
  if (!response.ok) throw new Error();
  const { active, canceled } = await response.json();
  if (active) {
    protectOperation(active.monthly, active.status);
    status.textContent = active.status === 'approved'
      ? 'La orden de prueba fue aprobada y permanece bloqueada para evitar duplicados.'
      : 'Ya existe una operación de prueba. Confirma su estado antes de reintentar.';
    if (['button', 'cajita'].includes(active.paymentKind) && active.status === 'reserved') {
      document.querySelector('#pending-message strong').textContent = 'Verificación de pago pendiente';
      document.querySelector('#pending-message p').textContent = 'Puedes modificar la renovación. Verifica el pago anterior antes de continuar.';
      document.querySelector('#transfer-pending strong').textContent = 'Verificación de pago pendiente';
      document.querySelector('#transfer-pending p').textContent = 'Puedes modificar la renovación. Verifica el pago anterior antes de continuar.';
      const closeTest = document.createElement('button');
      closeTest.type = 'button';
      closeTest.className = 'button-secondary action-button';
      closeTest.textContent = 'Cancelar transacción';
      closeTest.addEventListener('click', async () => {
        if (!window.confirm('Solo para esta prueba: cierra la página de PayPhone. ¿Confirmas que no ingresaste datos de tarjeta ni pulsaste Pagar?')) return;
        closeTest.disabled = true;
        try {
          const result = await fetch('/sandbox-payphone/cerrar-sin-pago', { method: 'POST', headers: { 'X-Local-Sandbox': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ noCardDataOrPayment: true }) });
          if (!result.ok) throw new Error();
          location.assign('/renovacion.html');
        } catch { closeTest.disabled = false; status.textContent = 'No se pudo cerrar la orden. Revisa su estado antes de reintentar.'; }
      });
      document.querySelector('.payment-options').after(closeTest);
      document.dispatchEvent(new CustomEvent('sandbox-allow-pending-edit'));
      history.replaceState(null, '', location.pathname);
    }
    if (active.status === 'approved') {
      demoRenewalAdapter.finish = async code => {
        const response = await fetch('/sandbox-payphone/finalizar', { method: 'POST', headers: { 'X-Local-Sandbox': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
        if (!response.ok) throw new Error('No se pudo finalizar la prueba.');
        location.assign('https://tbc.tributasoft.ec/Erp-web/templates/registro/login.xhtml');
      };
      const resume = document.createElement('button');
      resume.type = 'button';
      resume.className = 'button-secondary action-button';
      resume.textContent = 'Continuar verificación';
      resume.addEventListener('click', () => document.dispatchEvent(new CustomEvent('sandbox-payment-approved')));
      status.after(resume);
      if (new URLSearchParams(location.search).get('pago') === 'aprobado') {
        history.replaceState(null, '', location.pathname);
        document.dispatchEvent(new CustomEvent('sandbox-payment-approved'));
      }
    }
  } else {
    ready = true;
    if (canceled) {
      document.querySelector('#confirm-plan').click();
      const message = document.querySelector('#card-resolution-message');
      message.textContent = 'Transacción cancelada. Puedes intentar de nuevo o elegir otro método de pago.';
      message.hidden = false;
      document.querySelector('[data-method="tarjeta"]').click();
      document.querySelector('.payment-options').scrollIntoView({ block: 'center' });
      history.replaceState(null, '', location.pathname);
    }
    if (wantsCard && wantsStart) void prepareCajita();
  }
} catch {
  status.textContent = 'No se pudo comprobar el estado de la operación. No inicies otro pago.';
}

async function prepareCajita() {
  if (!ready || !wantsCard || !wantsStart || started) return;
  if (!terms.checked) { status.textContent = ''; return; }
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
    status.textContent = '';
  } catch {
    status.textContent = 'No se pudo preparar la Cajita. Confirma el estado de la operación antes de reintentar.';
  }
}
