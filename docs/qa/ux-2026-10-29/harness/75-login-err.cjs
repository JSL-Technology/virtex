const { launch, instrument, resetThrottle, BASE } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  await page.goto(BASE + '/es/auth/login?reason=expired'); await page.waitForTimeout(3000);
  await page.locator('input[type=email]').fill('dev@virtex.local'); await page.locator('input[type=password]').fill('QA-Test-Pass-2026!');
  await page.locator('button[type=submit]').click(); await page.waitForTimeout(5000);
  console.log(page.url()); console.log(log.req.filter(r => /auth\/login/.test(r)).join('\n'));
  await browser.close();
})();
