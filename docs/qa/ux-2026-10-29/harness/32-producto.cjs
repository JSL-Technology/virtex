const { launch, instrument, shot, panel, fields, errors, text, go, resetThrottle } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { browser, context } = await launch({ storageState: __dirname + '/state-mx.json' });
  const page = await context.newPage(); const log = instrument(page);
  await go(page, 'inventory/products');
  await panel(page).getByRole('button', { name: /Nuevo producto/ }).or(panel(page).getByRole('link', { name: /Nuevo producto/ })).first().click(); await page.waitForTimeout(2500);
  await shot(page, 'T-prod-1-form', true); console.log('URL', page.url());
  const t = await text(page); console.log(t.replace(/\n(Afganistán|Albania)[\s\S]*?Zimbabue/, '[paises]').slice(0, 2500));
  console.log((await fields(page)).join('\n'));
  await panel(page).getByRole('button', { name: /Guardar|Crear/ }).last().click(); await page.waitForTimeout(1500);
  console.log('ERR vacio', await errors(page)); await shot(page, 'T-prod-2-vacio', true);
  console.log(log.req.slice(-10).join('\n'));
  await browser.close();
})();
