const RATE_PER_DOCUMENT_CENTS = 20;
const FIXED_CENTS = 600;
const TAX_RATE = 0.15;
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("en-US");

export function calculateQuote(monthly) {
  if (!Number.isSafeInteger(monthly) || monthly < 1 || monthly > Math.floor((Number.MAX_SAFE_INTEGER - FIXED_CENTS) / 240)) {
    return null;
  }
  const annual = monthly * 12;
  const baseCents = FIXED_CENTS + annual * RATE_PER_DOCUMENT_CENTS;
  const taxCents = Math.round(baseCents * TAX_RATE);
  return { monthly, annual, baseCents, taxCents, totalCents: baseCents + taxCents };
}

export function mountQuote(root = document) {
  const input = root.querySelector("[data-monthly]");
  const error = root.querySelector("[data-quote-error]");
  const minus = root.querySelector("[data-decrease]");
  const plus = root.querySelector("[data-increase]");
  const fields = Object.fromEntries([...root.querySelectorAll("[data-quote-value]")].map(node => [node.dataset.quoteValue, node]));
  const update = () => {
    const value = input.value.trim();
    const quote = value ? calculateQuote(Number(value)) : null;
    error.hidden = Boolean(quote);
    input.setAttribute("aria-invalid", String(!quote));
    for (const key of ["annual", "base", "tax", "total"]) {
      fields[key].textContent = !quote ? "—" : key === "annual" ? integer.format(quote.annual) : currency.format(quote[key + "Cents"] / 100);
    }
    root.dispatchEvent(new CustomEvent("quotechange", { detail: quote }));
    return quote;
  };
  input.addEventListener("input", update);
  minus.addEventListener("click", () => {
    const current = Number(input.value);
    input.value = String(Math.max(1, Number.isSafeInteger(current) ? current - 1 : 1));
    update();
  });
  plus.addEventListener("click", () => {
    const current = Number(input.value);
    input.value = String(Number.isSafeInteger(current) && current >= 1 ? current + 1 : 1);
    update();
  });
  update();
  return { current: () => calculateQuote(Number(input.value)) };
}
