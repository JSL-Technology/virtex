const { launch, instrument, shot, panel, fields, errors, text, go, resetThrottle } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { browser, context } = await launch({ storageState: __dirname + '/state-mx.json' });
  const page = await context.newPage(); const log = instrument(page);
  await go(page, 'contacts/suppliers'); await panel(page).getByRole('button', { name: /Nuevo proveedor/ }).or(panel(page).getByRole('link', { name: /Nuevo proveedor/ })).first().click(); await page.waitForTimeout(2500);
  await shot(page, 'T-prov-1-form', true); console.log('URL', page.url());
  console.log((await text(page)).replace(/\n(Afganistán)[\s\S]*?Zimbabue/, '[paises]').replace(/\nAguascalientes[\s\S]*?Zacatecas/, '[estados]').slice(0, 1500)); console.log((await fields(page)).join('\n'));
  const P = panel(page);
  await P.getByLabel(/Nombre|Razón social/).first().fill('QA-Proveedor Café Orgánico del Soconusco S.P.R. de R.L.');
  const doc = P.getByLabel(/Número de documento|RFC/).first(); if (await doc.count()) await doc.fill('QAC9001011A6');
  await P.getByRole('button', { name: /Guardar/ }).last().click(); await page.waitForTimeout(2500);
  console.log('prov →', page.url(), await errors(page));
  // factura proveedor
  await go(page, 'accounts-payable'); await panel(page).getByRole('button', { name: /Nueva factura/ }).or(panel(page).getByRole('link', { name: /Nueva factura/ })).first().click(); await page.waitForTimeout(3000);
  await shot(page, 'T-ap-1-form', true); console.log('AP URL', page.url());
  console.log((await text(page)).replace(/\nPAB[\s\S]*?yuan renminbi/, '[monedas]').slice(0, 2200)); console.log((await fields(page)).join('\n'));
  await browser.close();
})();
