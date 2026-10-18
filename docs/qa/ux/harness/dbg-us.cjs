const { launch, login, shot, nav } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch({ locale: 'en-US' });
  const page = await context.newPage();
  await login(page, { email: 'qa.ux.en-us.869854@example.com', password: 'Sup3r-Segura-2026!' }, 'en');
  await nav(page, 'Sales', 'Customers');
  await shot(page, 'dbg-us'); console.log(page.url());
  console.log(await page.locator('.dv-active-group .dv-content-container').first().innerText().catch(e=>e.message));
  await browser.close();
})();
