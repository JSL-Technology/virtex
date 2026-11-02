// POS: abrir turno (inválido/válido), ticket, aparcar/recuperar, cobrar (insuficiente, mixto, cambio), diario, reporte X, anular, cierre y Z.
const { launch, instrument, shot, ADMIN, netSince } = require('./lib.cjs');
const POS = 'http://localhost:4300';
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 200)));
  await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await page.goto(POS + '/login'); await page.waitForTimeout(2500);
  await page.locator('input[type=email], input[autocomplete=username]').first().fill(ADMIN.email); await page.locator('input[type=password]').first().fill(ADMIN.password); await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(5000);
  const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); const pr = await page.evaluate(() => window.__printed).catch(() => '?'); console.log(`[${name}] print=${pr} red=${JSON.stringify(netSince(log, n).map((x) => x.replace('http://localhost:4300', ''))).slice(0, 700)}\n   UI=${(await body()).slice(0, +(process.env.LEN || 500))}`); await shot(page, `posf-${name}`); };
  const dlg = () => page.locator('[role=dialog], dialog[open]').last();
  if(0) await step('1-turno-negativo', async () => { const f = page.getByLabel(/Fondo de caja/).first(); await f.fill('-50'); await page.getByRole('button', { name: 'Abrir turno' }).click(); });
  if(0) await step('2-turno', async () => { const f = page.getByLabel(/Fondo de caja/).first(); await f.fill('2000'); await page.getByRole('button', { name: 'Abrir turno' }).click(); await page.waitForTimeout(1500); });
  await step('3-agregar', async () => { await page.getByRole('button', { name: /QA3-7734/ }).click(); await page.getByRole('button', { name: /QA3-7734/ }).click(); await page.getByRole('button', { name: /QA3-5521/ }).click(); });
  if(0) await step('4-escaner', async () => { const s = page.getByPlaceholder(/Busca productos/); await s.fill('QA3-SKU-7734'); await s.press('Enter'); });
  if(0) await step('5-aparcar', async () => { await page.getByRole('button', { name: /Aparcar/ }).click(); await page.waitForTimeout(800); const d = dlg(); if (await d.count()) { console.log('   DLG', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 200)); await d.getByRole('button').last().click(); } });
  if(0) await step('6-recuperar', async () => { await page.getByRole('button', { name: 'Recuperar' }).click(); await page.waitForTimeout(800); const d = dlg(); console.log('   DLG', (await d.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)); const b = d.getByRole('button').filter({ hasText: /Recuperar|QA3|RD\$/ }).first(); if (await b.count()) await b.click(); });
  await step('7-cobrar-abrir', async () => { await page.getByRole('button', { name: /Cobrar/ }).first().click(); await page.waitForTimeout(1000); console.log('   DLG', (await dlg().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 700)); });
  const recv = () => dlg().getByLabel(/Efectivo recibido|Recibido/).first();
  await step('8-insuficiente', async () => { const inp = dlg().locator('input').first(); await inp.fill('7000'); await page.waitForTimeout(500); const b = dlg().getByRole('button', { name: /Confirmar cobro/ }); console.log('   deshab', await b.isDisabled(), (await dlg().innerText()).replace(/\s+/g, ' ').slice(0, 400)); });
  await step('9-cambio', async () => { const inp = dlg().locator('input').first(); await inp.fill('10000'); await page.waitForTimeout(500); console.log('   ', (await dlg().innerText()).replace(/\s+/g, ' ').slice(0, 300)); await dlg().getByRole('button', { name: /Confirmar cobro/ }).click(); await page.waitForTimeout(3000); });
  await step('10-diario', async () => { await page.keyboard.press('F6'); await page.waitForTimeout(1500); console.log('   DLG', (await dlg().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
