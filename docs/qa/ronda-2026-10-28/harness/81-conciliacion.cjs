const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  process.env.STEPUP_PASS = 'QA3-Pass-Segura-2026!';
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(2000); await stepUpAll(page); console.log(`[${name}] url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-250)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 700)}`); await shot(page, `rec-${name}`); };
  await go(page, 'accounting/reconciliation/import');
  await step('1-vacio', async () => { await p.getByRole('button', { name: 'Importar estado de cuenta' }).click(); });
  await step('2-cuenta', async () => { const cb = p.locator('input[type=text]').first(); await cb.click(); await cb.fill('QA3-6620'); await page.waitForTimeout(1200); await page.locator('[role=option]').first().click(); });
  await step('3-malo', async () => { await p.locator('input[type=file]').setInputFiles('/tmp/claude-0/files/malo.csv'); await page.waitForTimeout(2000); console.log('   FORM', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 900)); });
  await step('4-bueno', async () => { await p.locator('input[type=file]').setInputFiles('/tmp/claude-0/files/estado-qa3.csv'); await page.waitForTimeout(2000); console.log('   FORM', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 1200)); console.log('   VALS', JSON.stringify(await p.locator('input, select').evaluateAll((es) => es.filter((e) => e.offsetWidth && e.type !== 'file').map((e) => `${e.getAttribute('formcontrolname') || e.placeholder || e.type}=${e.value}`)))); });
  await step('5-fechas-saldos', async () => {
    const dates = p.locator('input[type=date]'); await dates.nth(0).fill('2026-10-28'); await dates.nth(1).fill('2026-10-31');
    await p.locator('[formcontrolname=startingBalance]').fill('50000'); await p.locator('[formcontrolname=endingBalance]').fill('-6526.95');
    await p.getByRole('button', { name: 'Importar estado de cuenta' }).click(); await page.waitForTimeout(3000);
    console.log('   RES', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 1500));
  });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
