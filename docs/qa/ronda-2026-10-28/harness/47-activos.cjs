const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  page.on('dialog', (d) => d.accept());
  process.env.STEPUP_PASS = 'QA3-Pass-Segura-2026!';
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(2000); await stepUpAll(page); console.log(`[${name}] url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-200)}" err=${JSON.stringify(await errorsShown(page)).slice(0, 300)}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 500)}\n   UI=${(await panelText(page)).replace(/\s+/g, ' ').slice(0, 500)}`); await shot(page, `af-${name}`); };
  const acct = async (label, code) => { const i = p.getByLabel(label, { exact: false }).first(); await i.click(); await i.fill(code); await page.waitForTimeout(1200); await page.locator('[role=option]').filter({ hasText: code }).first().click(); };
  
  if(0) await step('1-vacio', async () => { await p.getByRole('button', { name: 'Guardar' }).click(); });
  if(0) await step('2-residual-mayor', async () => { await p.locator('[formcontrolname=name]').fill('QA3-AF-3391 Laptop QA'); const d = p.locator('input[type=date]'); await d.nth(0).fill('2026-08-01'); await d.nth(1).fill('2026-08-01'); await p.locator('[formcontrolname=cost]').fill('60000'); await p.locator('[formcontrolname=residualValue]').fill('70000'); await p.locator('[formcontrolname=usefulLifeMonths]').fill('36'); await acct('Cuenta del activo', '1210'); await acct('Cuenta de depreciación acumulada', '1220'); await p.getByRole('button', { name: 'Guardar' }).click(); });
  if(0) await step('3-valido', async () => { await p.locator('[formcontrolname=residualValue]').fill('6000'); await p.getByRole('button', { name: 'Guardar' }).click(); await page.waitForTimeout(1500); });
  await go(page, 'accounting/fixed-assets/depreciation');
  await step('4-dep-form', async () => { console.log('   CTRLS', JSON.stringify(await p.locator('input, select').evaluateAll((es) => es.map((e) => `${e.type}=${e.value}`)))); });
  await step('5-ejecutar', async () => { const m = p.locator('input[type=month], input[type=date]').first(); if (await m.count()) await m.fill(await m.getAttribute('type') === 'month' ? '2026-09' : '2026-09-30'); await p.getByRole('button', { name: 'Registrar depreciación' }).click(); await page.waitForTimeout(1500); const d = page.locator('[role=dialog]').last(); if (await d.count()) { console.log('   DLG', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 300)); await d.getByRole('button').last().click(); await page.waitForTimeout(2500); } });
  await go(page, 'accounting/fixed-assets'); await step('6-lista', async () => {});
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
