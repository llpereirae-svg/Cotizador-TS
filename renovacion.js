import { mountQuote } from "./assets/quote.js";
import { demoRenewalAdapter } from "./renovacion-mock.js";

// Contexto de demostración. La integración real debe recibir estos datos del
// backend autenticado; la URL no acredita ni autoriza al titular de la cuenta.
export function renderCustomerContext() {
  document.querySelectorAll("[data-customer-type]").forEach(node => { node.textContent = "Identificación"; });
  document.querySelectorAll("[data-customer-id]").forEach(node => { node.textContent = "—"; });
  document.querySelectorAll("[data-customer-name]").forEach(node => { node.textContent = "Cliente por identificar"; });
  let customer;
  try { customer = JSON.parse(document.querySelector("#customer-context").textContent); } catch { return; }
  const kind = customer?.tipoIdentificacion;
  const id = typeof customer?.identificacion === "string" ? customer.identificacion : "";
  const name = typeof customer?.nombre === "string" ? customer.nombre.trim().slice(0, 150) : "";
  const validId = (kind === "RUC" && /^\d{13}$/.test(id)) || (kind === "Cédula" && /^\d{10}$/.test(id));
  if (!validId || !name) return;
  document.querySelectorAll("[data-customer-type]").forEach(node => { node.textContent = kind; });
  document.querySelectorAll("[data-customer-id]").forEach(node => { node.textContent = id; });
  document.querySelectorAll("[data-customer-name]").forEach(node => { node.textContent = name; });
}
renderCustomerContext();

function estimateExpiry(today) {
  const year = today.getFullYear() + 1;
  const month = today.getMonth();
  const day = Math.min(today.getDate(), new Date(year, month + 1, 0).getDate());
  const localDate = new Date(year, month, day);
  const iso = [year, String(month + 1).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
  return { iso, label: new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "long", year: "numeric" }).format(localDate) };
}
let expiryEstimate;
let midnightTimer;
function refreshExpiry() {
  const today = new Date();
  const nextEstimate = estimateExpiry(today);
  const changed = expiryEstimate && expiryEstimate.iso !== nextEstimate.iso;
  expiryEstimate = nextEstimate;
  const expiryNode = document.querySelector("#estimated-expiry");
  expiryNode.dateTime = expiryEstimate.iso;
  expiryNode.textContent = expiryEstimate.label;
  document.querySelector("#copyright-year").textContent = String(today.getFullYear());
  if (changed) noteOperationChange();
  clearTimeout(midnightTimer);
  const nextMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  midnightTimer = setTimeout(refreshExpiry, Math.max(1000, nextMidnight.getTime() - today.getTime() + 100));
}

const quote = mountQuote();
const methods = [...document.querySelectorAll("[data-method]")];
const bankPanel = document.querySelector("#bank-panel");
const cardPanel = document.querySelector("#card-panel");
const operation = document.querySelector("#operation");
const codeEntry = document.querySelector("#code-entry");
const codeRequestMessage = document.querySelector("#code-request-message");
const receiptInput = document.querySelector("#receipt");
const renewalButton = document.querySelector("#simulate-renewal");
const transferPending = document.querySelector("#transfer-pending");
const cardResolutionMessage = document.querySelector("#card-resolution-message");
const codeInput = document.querySelector("#email-code");
const codeMessage = document.querySelector("#code-message");
const finishRenewal = document.querySelector("#finish-renewal");
const codeDialog = document.querySelector("#code-dialog");
const termsDialog = document.querySelector("#terms-dialog");
const cardTerms = document.querySelector("#card-terms");
const transferMessage = document.querySelector("#transfer-message");
const pendingMessage = document.querySelector("#pending-message");
let codeVerified = false;
let verificationReference = null;
let cardPending = false;
let selectedMethod = "banco";
let operationRevision = 0;
let receiptRevision = 0;
let pendingSubmission = null;
let codeRequestInFlight = false;
let verificationInFlight = false;
const bankDetails = document.querySelector(".bank-details");
const bankSummary = bankDetails.querySelector("summary");

function noteOperationChange() {
  operationRevision += 1;
  if (transferMessage.dataset.kind !== "pending" || !cardPending) {
    transferMessage.textContent = "";
    delete transferMessage.dataset.kind;
  }
}

refreshExpiry();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshExpiry();
});

document.querySelectorAll("[data-open-terms]").forEach(link => link.addEventListener("click", event => { event.preventDefault(); termsDialog.showModal(); }));
document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
cardTerms.addEventListener("change", () => {
  if (selectedMethod === "tarjeta" && cardTerms.checked) document.dispatchEvent(new CustomEvent("paymentmethodchange", { detail: { method: "tarjeta" } }));
});

function selectMethod(button) {
  if (selectedMethod === button.dataset.method) {
    if (selectedMethod === "tarjeta") document.dispatchEvent(new CustomEvent("paymentmethodchange", { detail: { method: selectedMethod } }));
    return;
  }
  noteOperationChange();
  resetCode();
  const selected = button.dataset.method;
  selectedMethod = selected;
  methods.forEach(option => {
    const active = option === button;
    option.classList.toggle("is-selected", active);
    option.setAttribute("aria-selected", String(active));
    option.tabIndex = active ? 0 : -1;
  });
  bankPanel.hidden = selected !== "banco";
  cardPanel.hidden = selected !== "tarjeta";
  document.dispatchEvent(new CustomEvent("paymentmethodchange", { detail: { method: selected } }));
}

operation.addEventListener("change", () => {
  noteOperationChange();
  resetCode();
});

methods.forEach((button, index) => {
  button.addEventListener("click", () => selectMethod(button));
  button.addEventListener("keydown", event => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % methods.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + methods.length) % methods.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = methods.length - 1;
    else return;
    event.preventDefault();
    methods[next].focus();
    selectMethod(methods[next]);
  });
});

function resetCode() {
  finishRenewal.hidden = true;
  receiptRevision += 1;
  codeVerified = false;
  verificationReference = null;
  pendingSubmission = null;
  codeInput.value = "";
  codeEntry.hidden = true;
  codeMessage.textContent = "";
}

function validReceipt(file) {
  if (!file) return false;
  const match = /\.(jpg|jpeg|png|pdf)$/i.exec(file.name);
  if (!match || file.size > 500000 || file.size === 0) return false;
  const allowedTypes = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf" };
  return !file.type || file.type.toLowerCase() === allowedTypes[match[1].toLowerCase()];
}

async function openCodeDemo() {
  if (codeRequestInFlight) return;
  codeRequestInFlight = true;
  const revision = ++receiptRevision;
  finishRenewal.hidden = true;
  codeVerified = false;
  verificationReference = null;
  codeInput.value = "";
  renewalButton.disabled = true;
  try {
    await demoRenewalAdapter.requestEmailCode();
    if (revision !== receiptRevision) return;
    codeEntry.hidden = false;
    codeMessage.textContent = "";
    if (!codeDialog.open) codeDialog.showModal();
  } catch {
    if (revision === receiptRevision) transferMessage.textContent = "No se pudo iniciar la verificación. Intenta nuevamente.";
  } finally {
    codeRequestInFlight = false;
    renewalButton.disabled = cardPending;
  }
}

document.addEventListener("sandbox-payment-approved", () => { pendingSubmission = null; void openCodeDemo(); });

bankSummary.addEventListener("click", event => {
  if (!cardPending) return;
  event.preventDefault();
  transferPending.hidden = false;
});

for (const button of document.querySelectorAll(".copy-account")) {
  button.addEventListener("click", async () => {
    const message = document.querySelector(".copy-message");
    if (cardPending) return;
    const number = button.closest("li").querySelector(".copy-value, .bank-number strong").textContent.trim();
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(number);
      message.textContent = "Dato copiado.";
    } catch {
      message.textContent = "No pudimos copiar el dato. Selecciónalo y cópialo manualmente.";
    }
  });
}

document.querySelector("#verify-code").addEventListener("click", async () => {
  if (verificationInFlight || codeVerified) return;
  verificationInFlight = true;
  document.querySelector("#verify-code").disabled = true;
  try {
  noteOperationChange();
  const revision = operationRevision;
  const result = await demoRenewalAdapter.verifyEmailCode(codeInput.value.trim());
  if (revision !== operationRevision) return;
  codeVerified = result.valid;
  verificationReference = result.verificacionReferencia;
  if (!result.valid) { codeMessage.textContent = "El código de prueba no coincide."; return; }
  if (pendingSubmission) {
    await demoRenewalAdapter.submitRenewal({ ...pendingSubmission, verificacionCorreoReferencia: verificationReference });
    if (revision !== operationRevision || cardPending) return;
    pendingSubmission = null;
    transferMessage.textContent = "Prueba completada. No se envió información ni se realizó ningún pago o renovación.";
    transferMessage.dataset.kind = "complete";
  }
  codeMessage.textContent = "Código de prueba verificado. No se envió información real.";
  finishRenewal.hidden = false;
  } catch {
    codeVerified = false;
    codeMessage.textContent = "No se pudo verificar el código. Intenta nuevamente.";
  } finally {
    verificationInFlight = false;
    document.querySelector("#verify-code").disabled = false;
  }
});

codeInput.addEventListener("input", () => {
  finishRenewal.hidden = true;
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
  const operationType = operation.value;
  const paymentDate = document.querySelector("#payment-date").value;
  const receiptSelected = validReceipt(receiptInput.files[0]);
  const terms = document.querySelector("#terms").checked;
  if (!currentQuote) {
    transferMessage.textContent = "Ingresa una cantidad válida de documentos.";
    transferMessage.dataset.kind = "validation";
    document.querySelector("#monthly").focus();
    return;
  }
  if (!bank || !paymentDate || !receiptSelected || !terms) {
    transferMessage.textContent = "Completa los datos, selecciona un archivo y acepta los términos.";
    transferMessage.dataset.kind = "validation";
    return;
  }
  pendingSubmission = {
    documentosPorMes: currentQuote.monthly,
    documentosPorAnio: currentQuote.annual,
    fechaVencimiento: expiryEstimate.iso,
    metodoPago: "transferencia_o_deposito",
    banco: bank,
    tipoOperacion: operationType,
    fechaPago: paymentDate,
    comprobanteSeleccionado: receiptSelected
  };
  void openCodeDemo();
});

document.querySelector("#simulate-pending").addEventListener("click", () => {
  noteOperationChange();
  cardPending = true;
  resetCode();
  bankDetails.open = false;
  bankSummary.setAttribute("aria-disabled", "true");
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
  bankSummary.removeAttribute("aria-disabled");
  pendingMessage.hidden = true;
  transferPending.hidden = true;
  renewalButton.disabled = false;
  renewalButton.removeAttribute("aria-describedby");
  transferMessage.textContent = "";
  delete transferMessage.dataset.kind;
  cardResolutionMessage.textContent = "Estado de prueba: cancelación confirmada. Puedes elegir otro método.";
  cardResolutionMessage.hidden = false;
});

receiptInput.addEventListener("change", () => {
  noteOperationChange();
  resetCode();
  const file = receiptInput.files[0];
  document.querySelector("#file-name").textContent = file?.name || "Sin archivo";
  if (!file) {
    codeRequestMessage.hidden = true;
    return;
  }
  if (!validReceipt(file)) {
    codeRequestMessage.textContent = "Selecciona un JPG, JPEG, PNG o PDF de hasta 500 KB (500,000 bytes).";
    codeRequestMessage.hidden = false;
    return;
  }
  if (cardPending) {
    codeRequestMessage.textContent = "Hay un pago con tarjeta pendiente. Confirma su estado antes de solicitar el código.";
    codeRequestMessage.hidden = false;
    return;
  }
  codeRequestMessage.hidden = true;
});

for (const selector of ["#bank", "#payment-date", "#terms"]) {
  document.querySelector(selector).addEventListener("change", () => { noteOperationChange(); resetCode(); });
}
document.addEventListener("quotechange", () => { noteOperationChange(); resetCode(); });
