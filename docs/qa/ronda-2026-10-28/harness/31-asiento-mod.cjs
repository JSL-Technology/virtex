const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1800); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-250)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 900)}`); await shot(page, `jem-${name}`); };
  await go(page, 'accounting/journal-entries');
  await p.locator('tbody tr').filter({ hasText: 'QA3-JE-2290' }).first().click(); await page.waitForTimeout(2500);
  await step('0-valores', async () => { console.log('   VALS', JSON.stringify(await p.locator('input, select, textarea').evaluateAll((es) => es.filter((e) => e.offsetWidth).map((e) => `${e.getAttribute('formcontrolname') || e.type}=${e.value}`)))); });
  await p.locator('input[type=date]').first().fill('2026-10-28'); if(0) await step('1-sin-razon', async () => { await p.locator('input[type=date]').first().fill('2026-10-28'); await p.getByRole('button', { name: 'Guardar asiento' }).click(); });
  await step('2-con-razon', async () => { await p.locator('[formcontrolname=modificationReason]').first().fill('QA3: fecha mal digitada (2031 → 2026)'); await p.getByRole('button', { name: 'Guardar asiento' }).click(); await page.waitForTimeout(2000); });
  await go(page, 'accounting/journal-entries/new');
  await step('3-nuevo-form', async () => { console.log('   FECHA-DEF', await p.locator('input[type=date]').first().inputValue(), 'LIBRO', await p.locator('select[formcontrolname=ledgerId]').inputValue()); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
