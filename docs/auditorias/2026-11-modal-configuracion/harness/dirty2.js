// Pruebas dirigidas de pérdida de cambios en secciones sin campo de texto simple.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'salida');
const BASE = 'http://localhost:4200';
const STATE = path.join(__dirname, 'state.json');
const shot = (name) => { const p = path.join(ROOT, 'shots', 'dirty2', name); fs.mkdirSync(path.dirname(p), { recursive: true }); return p; };

async function open(page, id) {
  await page.evaluate((s) => { location.hash = '#settings/' + s; }, id);
  await page.waitForSelector('.sm-panel');
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
const state = (page) => page.evaluate(() => ({
  modalOpen: !!document.querySelector('.sm-panel'),
  saveBar: document.querySelector('.ssb')?.innerText.replace(/\s+/g, ' ').trim() || null,
  autosave: document.querySelector('.sm-autosave')?.innerText.replace(/\s+/g, ' ').trim() || null,
  confirm: [...document.querySelectorAll('[role="dialog"]')].filter((d) => !d.classList.contains('sm-panel')).map((d) => d.innerText.replace(/\s+/g, ' ').trim().slice(0, 160)),
}));
async function reset(page) { await page.goto(BASE + '/e/virtex-dev/overview', { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(800); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'es-DO', storageState: STATE });
  const page = await ctx.newPage();
  await reset(page);
  const R = {};

  // 1) Correo saliente: ¿se perdió de verdad?
  await open(page, 'smtp');
  const smtpInput = page.locator('.sm-section input').first();
  const before = await smtpInput.inputValue();
  await smtpInput.click(); await page.keyboard.press('End'); await page.keyboard.type(' Prueba');
  await page.waitForTimeout(500);
  R.smtp = { before, typed: await smtpInput.inputValue(), dirty: await state(page) };
  await page.screenshot({ path: shot('smtp-1-con-cambios.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  R.smtp.afterEscape = await state(page);
  await page.screenshot({ path: shot('smtp-2-tras-escape.png') });
  await open(page, 'smtp');
  R.smtp.reopenedValue = await page.locator('.sm-section input').first().inputValue();
  await page.screenshot({ path: shot('smtp-3-reabierta.png') });
  await reset(page);

  // 2) Marca: elegir otro color de acento.
  await open(page, 'branding');
  const swatches = page.locator('.sm-section button[aria-label], .sm-section .swatch, .sm-section [class*="swatch"]');
  R.branding = { swatches: await swatches.count() };
  if (R.branding.swatches > 2) { await swatches.nth(2).click(); await page.waitForTimeout(600); }
  R.branding.dirty = await state(page);
  await page.screenshot({ path: shot('branding-1-con-cambios.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  R.branding.afterEscape = await state(page);
  await page.screenshot({ path: shot('branding-2-tras-escape.png') });
  if (R.branding.afterEscape.confirm.length) { await page.getByRole('button', { name: 'Descartar', exact: true }).last().click().catch(() => {}); }
  await reset(page);

  // 3) IA (autoguardado): escribir presupuesto y cerrar enseguida.
  await open(page, 'ai');
  const budget = page.getByLabel(/Presupuesto mensual/i).first();
  R.ai = { before: await budget.inputValue().catch(() => null) };
  await budget.click(); await budget.fill('1234');
  await page.waitForTimeout(400);
  R.ai.dirty = await state(page);
  await page.screenshot({ path: shot('ai-1-con-cambios.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
  R.ai.afterEscape = await state(page);
  await open(page, 'ai');
  R.ai.reopenedValue = await page.getByLabel(/Presupuesto mensual/i).first().inputValue().catch(() => null);
  await page.screenshot({ path: shot('ai-2-reabierta.png') });
  // Restaurar el valor anterior si cambió.
  if (R.ai.reopenedValue !== R.ai.before) { const b = page.getByLabel(/Presupuesto mensual/i).first(); await b.fill(R.ai.before ?? ''); await b.blur(); await page.waitForTimeout(1500); }
  await reset(page);

  // 4) Formato regional: cambiar un select.
  await open(page, 'regional-format');
  const sel = page.locator('.sm-section select').first();
  const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value));
  R.regional = { options: opts.length };
  await sel.selectOption(opts[1] ?? opts[0]); await page.waitForTimeout(600);
  R.regional.dirty = await state(page);
  await page.screenshot({ path: shot('regional-1-con-cambios.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  R.regional.afterEscape = await state(page);
  await page.screenshot({ path: shot('regional-2-tras-escape.png') });
  if (R.regional.afterEscape.confirm.length) { await page.getByRole('button', { name: 'Descartar', exact: true }).last().click().catch(() => {}); }
  await reset(page);

  // 5) Política de seguridad: conmutar la primera casilla o interruptor.
  await open(page, 'security');
  const toggle = page.locator('.sm-section input[type="checkbox"]:not([disabled]), .sm-section [role="switch"]').first();
  R.security = { toggles: await page.locator('.sm-section input[type="checkbox"], .sm-section [role="switch"]').count() };
  if (R.security.toggles) { await toggle.click({ force: true }); await page.waitForTimeout(600); }
  R.security.dirty = await state(page);
  await page.screenshot({ path: shot('security-1-con-cambios.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  R.security.afterEscape = await state(page);
  await page.screenshot({ path: shot('security-2-tras-escape.png') });
  if (R.security.afterEscape.confirm.length) { await page.getByRole('button', { name: 'Descartar', exact: true }).last().click().catch(() => {}); }
  await reset(page);

  // 6) Políticas contables: cambiar un select.
  await open(page, 'accounting-policies');
  const psel = page.locator('.sm-section select:not([disabled])').first();
  const popts = await psel.locator('option').evaluateAll((os) => os.map((o) => o.value)).catch(() => []);
  if (popts.length > 1) { const cur = await psel.inputValue(); await psel.selectOption(popts.find((v) => v !== cur)); await page.waitForTimeout(600); }
  R.policies = { dirty: await state(page) };
  await page.screenshot({ path: shot('policies-1-con-cambios.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  R.policies.afterEscape = await state(page);
  await page.screenshot({ path: shot('policies-2-tras-escape.png') });
  if (R.policies.afterEscape.confirm.length) { await page.getByRole('button', { name: 'Descartar', exact: true }).last().click().catch(() => {}); }

  fs.writeFileSync(path.join(ROOT, 'results', 'dirty2.json'), JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
