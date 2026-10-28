const button = document.querySelector('#start');
const status = document.querySelector('#status');

button.addEventListener('click', async () => {
  if (!document.querySelector('#test-terms').checked) { status.textContent = 'Acepta los términos de prueba para continuar.'; return; }
  button.disabled = true;
  status.textContent = 'Preparando la operación de prueba…';
  try {
    const response = await fetch('/sandbox-payphone/reservar', {
      method: 'POST', headers: { 'X-Local-Sandbox': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ monthly: 1, termsAccepted: true })
    });
    if (!response.ok) throw new Error('La reserva no está disponible.');
    const config = await response.json();
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'https://cdn.payphonetodoesposible.com/box/v2.0/payphone-payment-box.css';
    document.head.append(stylesheet);
    const sdk = document.createElement('script');
    sdk.type = 'module';
    sdk.src = 'https://cdn.payphonetodoesposible.com/box/v2.0/payphone-payment-box.js';
    await new Promise((resolve, reject) => { sdk.onload = resolve; sdk.onerror = reject; document.head.append(sdk); });
    if (typeof window.PPaymentButtonBox !== 'function') throw new Error('La Cajita no está disponible.');
    new window.PPaymentButtonBox(config).render('pp-button');
    status.textContent = '';
  } catch {
    status.textContent = 'No se pudo preparar la Cajita. La operación queda pendiente; verifica su estado antes de reintentar.';
  }
});
