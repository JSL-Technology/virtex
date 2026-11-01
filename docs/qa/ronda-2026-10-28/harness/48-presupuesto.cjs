const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(2000); await stepUpAll(page); console.log(`[${name}] toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-200)}" err=${JSON.stringify(await errorsShown(page)).slice(0, 300)}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 400)}\n   UI=${(await panelText(page)).replace(/\s+/g, ' ').slice(0, 700)}`); await shot(page, `pre-${name}`); };
  await go(page, 'accounting/budgets/new');
  await step('1-vacio', async () => { await p.getByRole('button', { name: 'Guardar' }).click(); });
  await step('2-valido', async () => { await p.locator('[formcontrolname=name]').fill('QA3-PRES-7012 Octubre'); await p.locator('[formcontrolname=period]').fill('2026-10'); const a = p.locator('tbody input[type=text], input[placeholder*=uenta]').first(); await a.click(); await a.fill('4100'); await page.waitForTimeout(1200); await page.locator('[role=option]').filter({ hasText: '4100' }).first().click(); await p.locator('[formcontrolname=amount]').first().fill('5000'); await p.getByRole('button', { name: 'Guardar' }).click(); });
  await go(page, 'accounting/variance-analysis'); await step('3-variacion', async () => { const b = p.getByRole('button', { name: /Consultar|Actualizar|Ver/ }).first(); if (await b.count()) await b.click(); });
  await go(page, 'overview'); await step('4-dashboard', async () => {});
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
