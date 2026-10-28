import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The preview must already be running locally. Playwright can be installed in
// this project or supplied via PLAYWRIGHT_MODULE_PATH for an existing install.
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const { chromium } = await import(modulePath ? pathToFileURL(path.join(modulePath, "index.mjs")).href : "playwright");
const baseUrl = new URL(process.env.COTIZADOR_TEST_URL || "http://127.0.0.1:8131");
if (!["127.0.0.1", "localhost", "[::1]"].includes(baseUrl.hostname)) {
  throw new Error("Las pruebas solo admiten el servidor local de la maqueta.");
}

async function withPage(run) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "es-EC" });
  const blocked = [];
  const errors = [];
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
    await page.goto(new URL("/renovacion.html", baseUrl).href, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector("[data-monthly]")?.getAttribute("aria-invalid") === "false");
    await run(page);
    assert.deepEqual(blocked, [], "La maqueta no debe enviar datos ni realizar solicitudes externas.");
    assert.deepEqual(errors, [], "No debe haber errores de JavaScript.");
  } finally {
    await browser.close();
  }
}

const sampleFile = name => ({ name, mimeType: "application/pdf", buffer: Buffer.from("comprobante de prueba") });

async function completeDemo(page) {
  await page.locator("#bank").selectOption("banco-ejemplo");
  await page.locator("#payment-date").fill("2026-11-01");
  await page.locator("#receipt").setInputFiles(sampleFile("primero.pdf"));
  await page.locator("#simulate-code").click();
  await page.locator("#email-code").fill("123456");
  await page.locator("#verify-code").click();
  await page.locator("#terms").check();
  await page.locator("#simulate-renewal").click();
  assert.match(await page.locator("#transfer-message").innerText(), /Simulación completada/);
}

test("cambiar el comprobante limpia el resultado y requiere verificar de nuevo", async () => {
  await withPage(async page => {
    await completeDemo(page);
    await page.locator("#receipt").setInputFiles(sampleFile("segundo.pdf"));
    assert.equal(await page.locator("#transfer-message").innerText(), "");
    assert.equal(await page.locator("#code-entry").isVisible(), false);
    assert.match(await page.locator("#code-request-message").innerText(), /comprobante cambió/);
  });
});

test("editar la operación mantiene el aviso y el bloqueo de tarjeta pendiente", async () => {
  await withPage(async page => {
    await page.locator("[data-method=tarjeta]").click();
    await page.locator("#simulate-pending").click();
    await page.locator("[data-method=transferencia]").click();
    await page.locator("[data-monthly]").fill("20");
    await page.locator("#bank").selectOption("banco-ejemplo");
    await page.locator("#payment-date").fill("2026-11-01");
    assert.equal(await page.locator("#transfer-pending").isVisible(), true);
    assert.equal(await page.locator("#simulate-renewal").isDisabled(), true);
  });
});
