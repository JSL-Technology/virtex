const { launch, login, shot, instrument, nav, fields } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Ventas', 'Facturas');
  const P = page.locator('.dv-active-group .dv-content-container');
  await P.locator('a, button').filter({ hasText: 'Nueva factura de venta' }).first().click(); await page.waitForTimeout(3000);
  await shot(page, 'F-fac-1-form');
  await shot(page, 'F-fac-1-form-full', true);
  console.log(JSON.stringify(await fields(page, P), null, 1));
  console.log((await P.innerText()).slice(0, 3000));
  console.log(log.req.filter(r=>!/geo|locali/.test(r)).slice(-15).join('\n'));
  await browser.close();
})();
