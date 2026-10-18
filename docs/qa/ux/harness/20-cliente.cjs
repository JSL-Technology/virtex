const { launch, login, shot, instrument, nav, fields, text } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Ventas', 'Clientes');
  await page.locator('.dv-active-group a, .dv-active-group button').filter({ hasText: 'Nuevo cliente' }).first().click(); await page.waitForTimeout(2500);
  await shot(page, 'F-cliente-1-form', true);
  console.log('URL', page.url());
  console.log(JSON.stringify(await fields(page), null, 1));
  console.log(await text(page, '.dv-active-group .dv-content-container'));
  await browser.close();
})();
