import { mountQuote } from "./assets/quote.js";
import { DEMO_EXPIRY, demoRenewalAdapter } from "./renovacion-mock.js";

const quote = mountQuote();
const methods = [...document.querySelectorAll("[data-method]")];
const transferPanel = document.querySelector("#transfer-panel");
const cardPanel = document.querySelector("#card-panel");
const codeEntry = document.querySelector("#code-entry");
const codeRequestMessage = document.querySelector("#code-request-message");
const receiptInput = document.querySelector("#receipt");
const renewalButton = document.querySelector("#simulate-renewal");
const transferPending = document.querySelector("#transfer-pending");
const cardResolutionMessage = document.querySelector("#card-resolution-message");
const codeInput = document.querySelector("#email-code");
const codeMessage = document.querySelector("#code-message");
const transferMessage = document.querySelector("#transfer-message");
const pendingMessage = document.querySelector("#pending-message");
let codeVerified = false;
let verificationReference = null;
let cardPending = false;
let operationRevision = 0;

function noteOperationChange() {
  operationRevision += 1;
  if (transferMessage.dataset.kind !== "pending" || !cardPending) {
    transferMessage.textContent = "";
    delete transferMessage.dataset.kind;
  }
}

methods.forEach(button => {
  button.addEventListener("click", () => {
    noteOperationChange();
    const selected = button.dataset.method;
    methods.forEach(option => {
      const active = option === button;
      option.classList.toggle("is-selected", active);
      option.setAttribute("aria-pressed", String(active));
    });
    transferPanel.hidden = selected !== "transferencia";
    cardPanel.hidden = selected !== "tarjeta";
  });
});

document.querySelector("#simulate-code").addEventListener("click", async () => {
  noteOperationChange();
  if (!receiptInput.files.length) {
    codeRequestMessage.textContent = "Selecciona primero un comprobante para simular el envío del código.";
    codeRequestMessage.hidden = false;
    receiptInput.focus();
    return;
  }
  codeRequestMessage.hidden = true;
  const revision = operationRevision;
  await demoRenewalAdapter.requestEmailCode();
  if (revision !== operationRevision || !receiptInput.files.length) return;
  codeVerified = false;
  verificationReference = null;
  codeInput.value = "";
  codeEntry.hidden = false;
  codeMessage.textContent = "No se envió ningún correo. Usa el código de ejemplo para probar la pantalla.";
  codeInput.focus();
});

document.querySelector("#verify-code").addEventListener("click", async () => {
  noteOperationChange();
  const revision = operationRevision;
  const result = await demoRenewalAdapter.verifyEmailCode(codeInput.value.trim());
  if (revision !== operationRevision) return;
  codeVerified = result.valid;
  verificationReference = result.verificacionReferencia;
  codeMessage.textContent = result.valid ? "Código de prueba verificado." : "El código de prueba no coincide.";
});

codeInput.addEventListener("input", () => {
  noteOperationChange();
  if (codeVerified) {
    codeVerified = false;
    verificationReference = null;
    codeMessage.textContent = "Vuelve a verificar el código de prueba.";
  }
});

renewalButton.addEventListener("click", async () => {
  if (cardPending) {
    renewalButton.disabled = true;
    transferMessage.textContent = "Hay un pago con tarjeta pendiente. Confirma su estado antes de completar otro.";
    transferMessage.dataset.kind = "pending";
    return;
  }
  const currentQuote = quote.current();
  const bank = document.querySelector("#bank").value;
  const operationType = document.querySelector("#operation").value;
  const paymentDate = document.querySelector("#payment-date").value;
  const receiptSelected = receiptInput.files.length > 0;
  const terms = document.querySelector("#terms").checked;
  if (!currentQuote) {
    transferMessage.textContent = "Ingresa una cantidad válida de documentos.";
    transferMessage.dataset.kind = "validation";
    document.querySelector("#monthly").focus();
    return;
  }
  if (!bank || !paymentDate || !receiptSelected || !codeVerified || !terms) {
    transferMessage.textContent = "Para probar el flujo, completa los datos, selecciona un archivo, verifica el código y confirma que es una vista de prueba.";
    transferMessage.dataset.kind = "validation";
    return;
  }
  const revision = operationRevision;
  await demoRenewalAdapter.submitRenewal({
    documentosPorMes: currentQuote.monthly,
    documentosPorAnio: currentQuote.annual,
    fechaVencimiento: DEMO_EXPIRY,
    metodoPago: "transferencia_o_deposito",
    banco: bank,
    tipoOperacion: operationType,
    fechaPago: paymentDate,
    comprobanteSeleccionado: receiptSelected,
    verificacionCorreoReferencia: verificationReference
  });
  if (revision !== operationRevision || cardPending) return;
  transferMessage.textContent = "Simulación completada. No se envió información ni se realizó ningún pago.";
  transferMessage.dataset.kind = "complete";
});

document.querySelector("#simulate-pending").addEventListener("click", () => {
  noteOperationChange();
  cardPending = true;
  pendingMessage.hidden = false;
  transferPending.hidden = false;
  renewalButton.disabled = true;
  renewalButton.setAttribute("aria-describedby", "transfer-pending");
  transferMessage.textContent = "";
  delete transferMessage.dataset.kind;
  cardResolutionMessage.hidden = true;
});

document.querySelector("#simulate-cancelled").addEventListener("click", () => {
  cardPending = false;
  pendingMessage.hidden = true;
  transferPending.hidden = true;
  renewalButton.disabled = false;
  renewalButton.removeAttribute("aria-describedby");
  transferMessage.textContent = "";
  delete transferMessage.dataset.kind;
  cardResolutionMessage.textContent = "Estado de prueba: cancelación confirmada. Puedes elegir otro método.";
  cardResolutionMessage.hidden = false;
});

receiptInput.addEventListener("change", event => {
  noteOperationChange();
  document.querySelector("#file-name").textContent = event.target.files[0]?.name || "Sin archivo";
  if (!codeEntry.hidden || codeVerified) {
    codeVerified = false;
    verificationReference = null;
    codeInput.value = "";
    codeEntry.hidden = true;
    codeMessage.textContent = "";
    codeRequestMessage.textContent = event.target.files.length
      ? "El comprobante cambió. Simula de nuevo el envío del código."
      : "El comprobante se retiró. Selecciona otro para simular el envío del código.";
    codeRequestMessage.hidden = false;
  } else {
    codeRequestMessage.hidden = true;
  }
});

for (const selector of ["#bank", "#operation", "#payment-date", "#terms"]) {
  document.querySelector(selector).addEventListener("change", noteOperationChange);
}
document.addEventListener("quotechange", noteOperationChange);
