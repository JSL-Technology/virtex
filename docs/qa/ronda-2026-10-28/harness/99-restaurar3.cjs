const { launch, instrument, uiLogin, go, panel, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page); await go(page, 'accounting/reconciliation'); await page.waitForTimeout(2000);
  const cb = p.locator('input[type=checkbox]').first(); const n = log.requests.length;
  if (await cb.isChecked()) { await cb.uncheck(); await page.waitForTimeout(2000); }
  console.log('checked', await cb.isChecked(), JSON.stringify(netSince(log, n)));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
