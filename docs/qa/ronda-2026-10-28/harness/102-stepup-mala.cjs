const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, stepUp, BASE } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  process.env.STEPUP_PASS = 'QA3-Pass-Segura-2026!';
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page); await go(page, 'payroll/runs'); const n = log.requests.length;
  await p.locator('tbody tr').first().locator('a, td').first().click(); await page.waitForTimeout(2000);
  const r = await stepUp(page, { wrongFirst: true });
  await page.waitForTimeout(2500);
  console.log('stepup', JSON.stringify(r), 'url', page.url().replace(BASE, ''), 'red', JSON.stringify(netSince(log, n)).slice(0, 700), 'toast', (await toasts(page)).replace(/\s+/g, ' ').slice(-200));
  console.log('UI', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 200));
  await shot(page, 'stepup-mala');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
