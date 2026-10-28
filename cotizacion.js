import { mountQuote } from "./assets/quote.js";

mountQuote();

const expiryElement = document.querySelector("#estimated-expiry");
const copyrightYear = document.querySelector("#copyright-year");
const displayDate = new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "long", year: "numeric" });
let midnightTimer;

function refreshDates() {
  const today = new Date();
  const nextYear = today.getFullYear() + 1;
  const month = today.getMonth();
  const lastDay = new Date(nextYear, month + 1, 0).getDate();
  const expiry = new Date(nextYear, month, Math.min(today.getDate(), lastDay));
  const monthText = String(expiry.getMonth() + 1).padStart(2, "0");
  const dayText = String(expiry.getDate()).padStart(2, "0");

  expiryElement.dateTime = String(expiry.getFullYear()) + "-" + monthText + "-" + dayText;
  expiryElement.textContent = displayDate.format(expiry);
  copyrightYear.textContent = String(today.getFullYear());

  clearTimeout(midnightTimer);
  const nextMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  midnightTimer = setTimeout(refreshDates, Math.max(1000, nextMidnight.getTime() - today.getTime() + 100));
}

refreshDates();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshDates();
});
