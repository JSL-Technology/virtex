const { launch, instrument, shot, panel, fields, errors, text, go, resetThrottle } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { browser, context } = await launch({ storageState: __dirname + '/state-mx.json' });
  const page = await context.newPage(); const log = instrument(page);
  await go(page, 'inventory/products/new'); const P = panel(page);
  await P.getByLabel(/Nombre del producto/).fill('QA-Café de Chiapas 1 kg «Altura» ☕');
  await P.getByLabel(/SKU/).fill('QA-CAFE-1KG');
  await P.getByLabel('Precio de venta').fill('-10'); await P.getByLabel('Precio de venta').blur();
  await P.getByLabel('Costo unitario').fill('123456789.123456');
  await page.waitForTimeout(500); console.log('neg/decimales →', await errors(page), await P.getByLabel('Costo unitario').inputValue());
  await P.getByLabel('Precio de venta').fill('350.50'); await P.getByLabel('Costo unitario').fill('180');
  await P.getByLabel('Existencia inicial').fill('100');
  await P.getByRole('button', { name: /Guardar producto/ }).click(); await page.waitForTimeout(2500);
  console.log('producto →', page.url(), await errors(page)); await shot(page, 'T-prod-3-guardado');
  // Factura
  const t0 = Date.now();
  await go(page, 'invoices'); await panel(page).getByRole('button', { name: /Nueva factura/ }).or(panel(page).getByRole('link', { name: /Nueva factura/ })).first().click(); await page.waitForTimeout(3000);
  await shot(page, 'T-fac-1-form', true); console.log('FACTURA URL', page.url());
  console.log((await text(page)).slice(0, 3000)); console.log((await fields(page)).join('\n'));
  console.log(log.req.slice(-12).join('\n'));
  await browser.close();
})();
