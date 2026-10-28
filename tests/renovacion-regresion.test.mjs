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

async function withPage(run, options = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: options.width || 390, height: 844 },
    locale: "es-EC",
    timezoneId: "America/Guayaquil"
  });
  if (options.now) await page.clock.install({ time: new Date(options.now) });
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

test("el resumen y el contrato usan el mismo JSON sin interpretar HTML", async () => {
  await withPage(async page => {
    assert.deepEqual(await page.locator("[data-customer-id]").allTextContents(), ["0999999999001", "0999999999001"]);
    await page.evaluate(async () => {
      const source = document.querySelector("#customer-context");
      const { renderCustomerContext } = await import("./renovacion.js?v=20261028-4");
      source.textContent = JSON.stringify({ tipoIdentificacion: "Cédula", identificacion: "0000000000", nombre: "<img src=x>", simulado: true });
      renderCustomerContext();
    });
    assert.deepEqual(await page.locator("[data-customer-id]").allTextContents(), ["0000000000", "0000000000"]);
    assert.equal(await page.locator("[data-customer-name]").textContent(), "<img src=x>");
    assert.equal(await page.locator("[data-customer-name] img").count(), 0);
    await page.evaluate(async () => {
      document.querySelector("#customer-context").textContent = "{}";
      (await import("./renovacion.js?v=20261028-4")).renderCustomerContext();
    });
    assert.deepEqual(await page.locator("[data-customer-id]").allTextContents(), ["—", "—"]);
  });
});

test("los términos se leen sin marcar la casilla y la verificación comienza al continuar", async () => {
  await withPage(async page => {
    assert.equal(await page.getByText("Verificación por correo").count(), 0);
    await page.locator("[data-open-terms]").first().click();
    assert.equal(await page.locator("#terms-dialog").isVisible(), true);
    assert.equal(await page.locator("#terms").isChecked(), false);
    await page.locator("#terms-dialog .dialog-done").click();
    await page.locator("#receipt").setInputFiles(sampleFile("ejemplo.pdf"));
    assert.equal(await page.locator("#code-dialog").isVisible(), false);
    await page.locator("[data-method=tarjeta]").click();
    assert.equal(await page.locator("#card-terms").isChecked(), false);
  });
});

async function completeDemo(page) {
  await page.locator("#bank").selectOption("banco-pacifico-ahorros");
  await page.locator("#payment-date").fill("2026-11-01");
  await page.locator("#receipt").setInputFiles(sampleFile("primero.pdf"));
  await page.locator("#terms").check();
  await page.locator("#simulate-renewal").click();
  await page.locator("#code-entry").waitFor({ state: "visible" });
  assert.equal(await page.locator("#finish-renewal").isVisible(), false);
  await page.locator("#email-code").fill("000000");
  await page.locator("#verify-code").click();
  assert.equal(await page.locator("#finish-renewal").isVisible(), false);
  await page.locator("#email-code").fill("123456");
  await page.locator("#verify-code").click();
  assert.equal(await page.locator("#finish-renewal").isVisible(), true);
  assert.equal(await page.locator("#finish-renewal").getAttribute("href"), "https://tbc.tributasoft.ec/Erp-web/templates/registro/login.xhtml");
  await page.locator("#code-dialog [data-close-dialog]").click();
  assert.match(await page.locator("#transfer-message").innerText(), /Prueba completada/);
}

test("depósito y transferencia se distinguen sin pedir tipo de depósito", async () => {
  await withPage(async page => {
    assert.equal(await page.locator("#deposit-type").count(), 0);
    await page.evaluate(async () => {
      const { demoRenewalAdapter } = await import("./renovacion-mock.js");
      demoRenewalAdapter.submitRenewal = async renewal => { window.lastRenewal = renewal; return { status: "simulado" }; };
    });
    await completeDemo(page);
    assert.equal(await page.evaluate(() => window.lastRenewal.tipoOperacion), "deposito");
    await page.locator("#operation").selectOption("transferencia");
    await page.locator("#simulate-renewal").click();
    await page.locator("#email-code").fill("123456");
    await page.locator("#verify-code").click();
    await page.locator("#code-dialog [data-close-dialog]").click();
    assert.equal(await page.evaluate(() => Object.hasOwn(window.lastRenewal, "tipoDeposito")), false);
    assert.equal(await page.evaluate(() => window.lastRenewal.tipoOperacion), "transferencia");
  });
});

test("cambiar el comprobante limpia el resultado y requiere verificar de nuevo", async () => {
  await withPage(async page => {
    await completeDemo(page);
    await page.locator("#receipt").setInputFiles(sampleFile("segundo.pdf"));
    assert.equal(await page.locator("#transfer-message").innerText(), "");
    assert.equal(await page.locator("#email-code").inputValue(), "");
    assert.equal(await page.locator("#code-dialog").isVisible(), false);
  });
});

test("editar la operación mantiene el aviso y el bloqueo de tarjeta pendiente", async () => {
  await withPage(async page => {
    await page.locator("[data-method=tarjeta]").click();
    await page.locator("#simulate-pending").evaluate(button => button.click());
    await page.locator("[data-method=banco]").click();
    await page.locator("[data-monthly]").fill("20");
    await page.locator("#bank").selectOption("banco-pacifico-ahorros");
    await page.locator("#payment-date").fill("2026-11-01");
    assert.equal(await page.locator("#transfer-pending").isVisible(), true);
    assert.equal(await page.locator("#simulate-renewal").isDisabled(), true);
  });
});

test("los bancos se muestran en el desplegable solo para transferencia", async () => {
  await withPage(async page => {
    const bankLabels = await page.locator("#bank option").allTextContents();
    assert.deepEqual(bankLabels, ["Banco Pacífico", "Pichincha", "ProCredit"]);
    const details = page.locator(".bank-details");
    assert.equal(await details.locator("summary").innerText(), "Ver datos bancarios para transferir");
    await details.locator("summary").focus();
    await page.keyboard.press("Enter");
    assert.equal(await details.evaluate(node => node.open), true);
    const accountValues = await details.locator(".bank-number strong").allTextContents();
    assert.equal(accountValues.length, 3);
    assert.ok(accountValues.every(value => /^\d{9,12}$/.test(value)), "Cada cuenta debe contener solo dígitos.");
    await page.locator("[data-method=tarjeta]").click();
    assert.equal(await details.isVisible(), false);
    assert.equal(await page.locator("#payphone-container").isVisible(), true);
    assert.equal(await page.locator("#payphone-container input").count(), 0);
  });
});

test("las opciones bancaria y tarjeta muestran el panel correspondiente", async () => {
  await withPage(async page => {
    const methods = page.locator("[data-method]");
    assert.deepEqual(await methods.evaluateAll(nodes => nodes.map(node => node.dataset.method)), ["banco", "tarjeta"]);
    assert.equal(await page.locator("#payment-title").innerText(), "Forma de Pago");
    assert.equal(await page.locator("#bank-panel").isVisible(), true);
    assert.deepEqual(await page.locator("#operation option").allTextContents(), ["Depósito", "Transferencia"]);
    await page.locator("[data-method=tarjeta]").click();
    assert.equal(await page.locator("#bank-panel").isVisible(), false);
    assert.equal(await page.locator("#card-panel").isVisible(), true);
    assert.equal(await page.locator(".payphone-logo").getAttribute("alt"), "PayPhone");
  });
});

test("las pestañas cambian con las flechas y conservan la opción en el formulario", async () => {
  await withPage(async page => {
    const bank = page.locator("#tab-banco");
    const card = page.locator("#tab-tarjeta");
    await bank.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await card.getAttribute("aria-selected"), "true");
    assert.equal(await card.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press("End");
    assert.equal(await page.locator("#card-panel").isVisible(), true);
    await page.keyboard.press("Home");
    assert.equal(await page.locator("#bank-panel #bank-form").count(), 1);
  });
});

test("copiar cuenta confirma el éxito o explica cómo copiarla manualmente", async () => {
  await withPage(async page => {
    await page.locator(".bank-details summary").click();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { window.copiedAccount = value; } } });
    });
    const rows = page.locator(".bank-details li");
    assert.equal(await rows.count(), 6);
    for (let index = 0; index < 6; index++) {
      const row = rows.nth(index);
      await row.locator(".copy-account").click();
      assert.equal(await page.evaluate(() => window.copiedAccount), await row.locator(".copy-value, .bank-number strong").innerText());
    }
    assert.match(await page.locator(".copy-message").innerText(), /copiado/i);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
    });
    await rows.first().locator(".copy-account").click();
    assert.match(await page.locator(".copy-message").innerText(), /manualmente/i);
  });
});

for (const [now, expected, year] of [
  ["2026-10-28T12:00:00-05:00", "2027-10-28", "2026"],
  ["2024-02-29T12:00:00-05:00", "2025-02-28", "2024"],
  ["2026-12-31T12:00:00-05:00", "2027-12-31", "2026"]
]) {
  test("la fecha de renovación es estimada y respeta el calendario para " + now.slice(0, 10), async () => {
    await withPage(async page => {
      assert.equal(await page.locator("#estimated-expiry").getAttribute("datetime"), expected);
      assert.match(await page.locator(".summary-caption").innerText(), /Vencimiento:/);
      assert.equal(await page.locator("#copyright-year").innerText(), year);
    }, { now });
  });
}

test("la fecha estimada y el copyright se actualizan al cambiar el día", async () => {
  await withPage(async page => {
    assert.equal(await page.locator("#estimated-expiry").getAttribute("datetime"), "2027-12-31");
    await page.clock.fastForward(5000);
    assert.equal(await page.locator("#estimated-expiry").getAttribute("datetime"), "2028-01-01");
    assert.equal(await page.locator("#copyright-year").innerText(), "2027");
  }, { now: "2026-12-31T23:59:58-05:00" });
});


test("archivos admitidos no abren la verificación antes de continuar y los inválidos se rechazan", async () => {
  await withPage(async page => {
    const receipt = page.locator("#receipt");
    assert.match(await receipt.getAttribute("accept"), /\.jpg/);
    for (const [name, mimeType] of [["prueba.jpg", "image/jpeg"], ["prueba.jpeg", "image/jpeg"], ["prueba.png", "image/png"], ["prueba.pdf", "application/pdf"]]) {
      await receipt.setInputFiles({ name, mimeType, buffer: Buffer.alloc(500000) });
      assert.equal(await page.locator("#code-dialog").isVisible(), false);
      assert.equal(await page.locator("#code-request-message").isVisible(), false);
    }
    for (const [name, mimeType, size] of [["prueba.pdf", "application/pdf", 500001], ["prueba.exe", "application/octet-stream", 1], ["falso.pdf", "image/png", 1], ["vacio.pdf", "application/pdf", 0]]) {
      await receipt.setInputFiles({ name, mimeType, buffer: Buffer.alloc(size) });
      assert.equal(await page.locator("#code-entry").isVisible(), false);
      assert.match(await page.locator("#code-request-message").innerText(), /500 KB/);
    }
  });
});

test("un pago pendiente cierra y bloquea las cuentas y la solicitud hasta resolverlo", async () => {
  await withPage(async page => {
    const details = page.locator(".bank-details");
    await details.locator("summary").click();
    assert.equal(await details.evaluate(node => node.open), true);
    await page.locator("[data-method=tarjeta]").click();
    await page.locator("#simulate-pending").evaluate(button => button.click());
    await page.locator("[data-method=banco]").click();
    assert.equal(await details.evaluate(node => node.open), false);
    await details.locator("summary").click();
    assert.equal(await details.evaluate(node => node.open), false);
    assert.equal(await page.locator("#transfer-pending").isVisible(), true);
    await page.locator("#receipt").setInputFiles(sampleFile("prueba.pdf"));
    assert.equal(await page.locator("#code-entry").isVisible(), false);
    assert.match(await page.locator("#code-request-message").innerText(), /pendiente/);
    await page.locator("[data-method=tarjeta]").click();
    await page.locator("#simulate-cancelled").click();
    await page.locator("[data-method=banco]").click();
    assert.equal(await page.locator("#code-dialog").isVisible(), false);
    await details.locator("summary").click();
    assert.equal(await details.evaluate(node => node.open), true);
  }, {width: 1366});
});

test("en móvil horizontal el resumen queda a la derecha y el logo permanece visible", async () => {
  await withPage(async page => {
    await page.setViewportSize({ width: 667, height: 375 });
    const consumo = await page.locator(".usage-card").boundingBox();
    const resumen = await page.locator(".summary-card").boundingBox();
    assert.ok(resumen.x >= consumo.x + consumo.width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => scrollTo(0, 300));
    assert.equal(Math.round((await page.locator(".site-header").boundingBox()).y), 0);
    await page.locator("[data-method=tarjeta]").click();
    assert.equal(await page.locator("#card-panel").isVisible(), true);
  });
});
