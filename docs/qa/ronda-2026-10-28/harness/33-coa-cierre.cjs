const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1800); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-250)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 900)}`); await shot(page, `cc-${name}`); };
  await go(page, 'accounting/chart-of-accounts/new');
  await step('1-vacio', async () => { await p.getByRole('button', { name: 'Guardar cuenta' }).click(); });
  await step('2-tipo-cat', async () => { await p.locator('[formcontrolname=type]').selectOption({ label: 'Gasto' }); await page.waitForTimeout(600); console.log('   CATS', JSON.stringify(await p.locator('[formcontrolname=category] option').allInnerTexts())); });
  await step('3-valida', async () => { await p.locator('[formcontrolname=code]').fill('5915'); await p.locator('[formcontrolname=name]').fill('QA3-5915 Gastos de prueba'); const par = p.locator('input[type=text]').nth(0); const cb = p.locator('input[type=text]').filter({ hasNot: p.locator('[formcontrolname]') }); const pc = p.locator('input:not([formcontrolname])[type=text]').first(); await pc.click(); await pc.fill('5000'); await page.waitForTimeout(1200); const o = page.locator('[role=option]'); console.log('   PADRE', JSON.stringify(await o.allInnerTexts()).slice(0, 300)); if (await o.count()) await o.first().click(); await p.locator('[formcontrolname=category]').selectOption({ index: 1 }); await p.getByRole('button', { name: 'Guardar cuenta' }).click(); await page.waitForTimeout(2000); });
  await go(page, 'accounting/chart-of-accounts');
  await step('4-buscar-editar', async () => { const s = p.locator('input[type=search], input[placeholder*=uscar]').first(); if (await s.count()) { await s.fill('5915'); await page.waitForTimeout(1200); } console.log('   LISTA', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 500)); const ed = p.getByRole('button', { name: /Editar/ }).first(); console.log('   editar', await ed.count()); });
  await go(page, 'accounting/periods');
  await step('5-cerrar-enero', async () => { await p.getByRole('button', { name: 'Cerrar período' }).first().click(); await page.waitForTimeout(1200); const d = page.locator('[role=dialog], [role=alertdialog]').last(); if (await d.count()) { console.log('   DLG', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 500)); await shot(page, 'cc-5-dialogo'); await d.getByRole('button').last().click(); } await page.waitForTimeout(3000); console.log('   PER', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 300)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
