const { launch, login, shot, instrument, nav, fields } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Ventas', 'Recibos');
  const P = page.locator('.dv-active-group .dv-content-container');
  const b = P.getByRole('button', { name: 'Nuevo recibo' }).or(P.getByRole('link', { name: 'Nuevo recibo' }));
  console.log('count', await b.count(), await b.first().evaluate(e => e.outerHTML.slice(0, 300)));
  log.req.length = 0; log.console.length = 0;
  await b.first().click(); await page.waitForTimeout(5000);
  console.log('URL', page.url()); console.log('REQ', log.req); console.log('CONSOLE', log.console, log.errors);
  await shot(page, 'F-cobro-2-tras-click');
  console.log(JSON.stringify(await fields(page, page.locator('.dv-active-group'))));
  await browser.close();
})();
