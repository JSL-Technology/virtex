const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  process.env.STEPUP_PASS = 'QA3-Pass-Segura-2026!';
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page);
  await go(page, 'payroll/runs'); await p.locator('tbody tr').first().locator('a, td').first().click(); await page.waitForTimeout(2500); await stepUpAll(page); await page.waitForTimeout(2000);
  await p.getByRole('button', { name: 'Marcar como pagada' }).click(); await page.waitForTimeout(1500);
  await p.locator('select').filter({ hasText: 'QA3-6620' }).selectOption({ value: '5e53bb19-f1c3-4706-9378-1466f07bdfeb' }); await page.waitForTimeout(600);
  console.log('CTRLS', JSON.stringify(await p.locator('input[type=radio], select').evaluateAll((es) => es.map((e) => `${e.type}:${e.checked}:${e.value}`))));
  const n = log.requests.length;
  await p.getByRole('button', { name: 'Registrar el pago' }).click(); await page.waitForTimeout(1500);
  const d = page.locator('[role=dialog]').last(); if (await d.count()) { console.log('DLG', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 300)); await d.getByRole('button').last().click(); }
  await page.waitForTimeout(2000); await stepUpAll(page); await page.waitForTimeout(2000);
  console.log('RED', JSON.stringify(netSince(log, n)).slice(0, 900), 'TOAST', (await toasts(page)).replace(/\s+/g, ' ').slice(-200));
  console.log('DOC', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 400));
  await shot(page, 'nom-pagada');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
