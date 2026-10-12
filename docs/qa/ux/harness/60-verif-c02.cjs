const { launch, login, shot } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await login(page);
  await context.route('**/api/v1/auth/session', () => {});
  await page.goto('http://localhost:4200/e/virtex-dev/invoices', { waitUntil: 'load' }).catch(()=>{});
  await page.waitForTimeout(3000); console.log('3s:', JSON.stringify((await page.locator('body').innerText()).trim().slice(0, 60))); await shot(page, 'fix/C02-arranque-3s');
  await page.waitForTimeout(11000); console.log('14s:', JSON.stringify((await page.locator('body').innerText()).trim().slice(0, 160))); await shot(page, 'fix/C02-arranque-14s');
  await page.waitForTimeout(6000); await shot(page, 'fix/C02-login-aviso'); console.log('20s url:', page.url(), JSON.stringify((await page.locator('body').innerText()).trim().slice(0, 80)));
  await browser.close();
})();
