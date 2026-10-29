const { session, MX, shot, panel, fields, errors, text, go, resetThrottle } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-mx.json', MX); let clicks = 0;
  await go(page, 'accounts-payable/new'); const P = panel(page);
  await P.getByLabel(/Proveedor/).first().click(); clicks++; await page.waitForTimeout(800);
  console.log('opts prov', (await page.locator('[role=option]').allInnerTexts()).slice(0, 4));
  await page.locator('[role=option]').first().click(); clicks++; await page.waitForTimeout(800);
  await P.getByLabel('Descripción').fill('QA-Compra de café verde 50 kg');
  await P.getByLabel('Cant.').fill('2'); await P.getByLabel('Precio').fill('4500');
  await P.getByLabel('Cuenta de gasto').click(); clicks++; await page.waitForTimeout(800);
  console.log('opts cuenta', (await page.locator('[role=option]').allInnerTexts()).slice(0, 8));
  await page.keyboard.type('Honorarios', { delay: 40 }); await page.waitForTimeout(1000);
  console.log('opts cuenta filtradas', (await page.locator('[role=option]').allInnerTexts()).slice(0, 6));
  if (await page.locator('[role=option]').count()) { await page.locator('[role=option]').first().click(); clicks++; }
  await page.waitForTimeout(800); await shot(page, 'T-ap-2-lleno', true);
  console.log((await text(page)).split('Detalles de la factura')[1]?.slice(0, 500));
  await P.getByRole('button', { name: 'Guardar factura' }).click(); clicks++; await page.waitForTimeout(3000);
  console.log('ap →', page.url(), await errors(page)); await shot(page, 'T-ap-3-guardada', true);
  console.log((await text(page)).slice(0, 1200));
  console.log('acciones', (await panel(page).getByRole('button').allInnerTexts()).map(s => s.trim()).filter(Boolean));
  console.log('CLICKS', clicks); console.log(log.req.filter(r => /payable|bill|vendor/.test(r)).slice(-5).join('\n'));
  await close();
})();
