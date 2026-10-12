const { launch, login, shot, instrument, nav, fields } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Inventario', 'Productos');
  const P = page.locator('.dv-active-group .dv-content-container');
  await P.locator('a, button').filter({ hasText: 'Nuevo producto' }).first().click(); await page.waitForTimeout(2500);
  await shot(page, 'F-prod-1-form', true);
  console.log(JSON.stringify(await fields(page, P), null, 1));
  console.log((await P.innerText()).slice(0, 2500));
  await browser.close();
})();
