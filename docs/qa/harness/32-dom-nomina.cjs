const { launch, uiLogin, go, panel } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page);
  await go(page, 'payroll/runs'); await page.waitForTimeout(1500);
  if (process.env.CLICK) { await panel(page).getByRole('link', { name: '2026-09' }).click(); await page.waitForTimeout(4000); const alive = await Promise.race([page.evaluate(() => location.pathname), new Promise((r) => setTimeout(() => r('FROZEN'), 6000))]); console.log('TRAS-CLIC', alive); await require('./lib.cjs').shot(page, 'f-nom-link'); await browser.close(); return; }
  console.log((await panel(page).locator('tbody tr').first().evaluate((e) => e.outerHTML.replace(/_ngcontent-[^=]+=""/g, '').replace(/\s+/g, ' '))).slice(0, 1500));
  await browser.close();
})();
