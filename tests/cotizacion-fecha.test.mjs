import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Start the quote worktree on a local HTTP port first. Playwright can be
// installed in this project or supplied via PLAYWRIGHT_MODULE_PATH.
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const { chromium } = await import(modulePath ? pathToFileURL(path.join(modulePath, "index.mjs")).href : "playwright");
const baseUrl = new URL(process.env.COTIZADOR_TEST_URL || "http://127.0.0.1:8132");
if (!["127.0.0.1", "localhost", "[::1]"].includes(baseUrl.hostname)) {
  throw new Error("Las pruebas solo admiten el servidor local de la maqueta.");
}

async function withPage({ instant, width = 390 }, run) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height: 844 }, locale: "es-EC", timezoneId: "America/Guayaquil" });
  const blocked = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== baseUrl.origin || request.method() !== "GET") {
      blocked.push({ origin: url.origin, method: request.method() });
      await route.abort();
    } else {
      await route.continue();
    }
  });
  try {
    await page.clock.install({ time: new Date(instant) });
    await page.goto(new URL("/cotizacion.html", baseUrl).href, { waitUntil: "load" });
    await page.waitForSelector("#estimated-expiry[datetime]");
    await run(page);
    assert.deepEqual(blocked, [], "La vista no debe enviar datos ni realizar solicitudes externas.");
    assert.deepEqual(errors, [], "No debe haber errores de JavaScript.");
  } finally {
    await browser.close();
  }
}

for (const [label, instant, expiry, year] of [
  ["fecha ordinaria", "2026-10-28T17:00:00Z", "2027-10-28", "2026"],
  ["fin de año", "2023-12-31T17:00:00Z", "2024-12-31", "2023"],
  ["día bisiesto", "2024-02-29T17:00:00Z", "2025-02-28", "2024"],
  ["febrero a año bisiesto", "2023-02-28T17:00:00Z", "2024-02-28", "2023"],
  ["fecha local al final del día", "2026-10-29T04:30:00Z", "2027-10-28", "2026"],
]) {
  test("el vencimiento estimado usa la fecha local: " + label, async () => {
    await withPage({ instant }, async page => {
      assert.equal(await page.locator("#estimated-expiry").getAttribute("datetime"), expiry);
      assert.equal(await page.locator("#copyright-year").innerText(), year);
      assert.match(await page.locator(".expiry-row").innerText(), /Vencimiento estimado/);
    });
  });
}

test("el vencimiento se actualiza al cambiar el día local", async () => {
  await withPage({ instant: "2026-10-29T04:59:30Z" }, async page => {
    assert.equal(await page.locator("#estimated-expiry").getAttribute("datetime"), "2027-10-28");
    await page.clock.fastForward("01:00");
    assert.equal(await page.locator("#estimated-expiry").getAttribute("datetime"), "2027-10-29");
  });
});

for (const width of [320, 390, 1366]) {
  test("la cotización conserva cálculo y diseño en " + width + " px", async () => {
    await withPage({ instant: "2026-10-28T17:00:00Z", width }, async page => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.match(await page.locator("h1").innerText(), /Cotizador de prepago/);
      assert.equal(await page.locator(".preview-mark").count(), 0);
      await page.locator("[data-monthly]").fill("10");
      assert.equal(await page.locator("[data-quote-value=annual]").innerText(), "120");
      assert.equal(await page.locator("[data-quote-value=total]").innerText(), "$34.50");
      await page.locator("[data-monthly]").fill("1");
      assert.equal(await page.locator("[data-quote-value=annual]").innerText(), "12");
      assert.equal(await page.locator("[data-quote-value=total]").innerText(), "$9.66");
    });
  });
}
