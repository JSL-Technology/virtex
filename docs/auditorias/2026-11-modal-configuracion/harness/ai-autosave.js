// ¿Cuándo guarda la sección de IA? Escribir y esperar sin salir del campo; luego salir del campo.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', 'salida');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'es-DO', storageState: path.join(__dirname, 'state.json') });
  const page = await ctx.newPage();
  const writes = [];
  page.on('request', (r) => { if (['PUT', 'PATCH', 'POST'].includes(r.method()) && r.url().includes('/api/')) writes.push(`${Date.now()} ${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
  await page.goto('http://localhost:4200/e/virtex-dev/overview', { waitUntil: 'networkidle' });
  await page.evaluate(() => { location.hash = '#settings/ai'; });
  await page.waitForSelector('.sm-panel'); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1200);
  const budget = page.getByLabel(/Presupuesto mensual/i).first();
  await budget.scrollIntoViewIfNeeded();
  await budget.click(); await budget.fill('1234');
  const t0 = Date.now();
  await page.waitForTimeout(4000);
  const afterWait = writes.slice();
  await page.screenshot({ path: path.join(ROOT, 'shots', 'dirty2', 'ai-3-escrito-4s-sin-salir.png') });
  await page.keyboard.press('Tab'); // salir del campo
  await page.waitForTimeout(2500);
  const afterBlur = writes.slice();
  await page.screenshot({ path: path.join(ROOT, 'shots', 'dirty2', 'ai-4-tras-salir-del-campo.png') });
  // Restaurar
  await budget.fill('200'); await page.keyboard.press('Tab'); await page.waitForTimeout(2500);
  const res = { msWaited: Date.now() - t0, writesWhileTyping4s: afterWait, writesAfterBlur: afterBlur.slice(afterWait.length) };
  fs.writeFileSync(path.join(ROOT, 'results', 'ai-autosave.json'), JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
