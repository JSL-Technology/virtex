const { launch, login, shot, instrument, nav, fields } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Compras', 'Proveedores');
  const P = page.locator('.dv-active-group .dv-content-container');
  await P.locator('a, button').filter({ hasText: /Nuevo proveedor/ }).first().click(); await page.waitForTimeout(2500);
  await shot(page, 'F-prov-1-form');
  console.log(JSON.stringify(await fields(page, P)));
  const L = (l) => P.getByLabel(l, { exact: false }).first();
  await P.getByRole('button', { name: /Guardar/ }).first().click(); await page.waitForTimeout(1500);
  console.log('VACIO', await page.locator('[role=alert], .toast').allInnerTexts());
  await shot(page, 'F-prov-2-vacio');
  const names = await P.locator('input[type=text]:visible').count();
  await L('Nombre del proveedor').fill('QA-UX Distribuidora Caribe, S.A.S.');
  await L('Correo').fill('ventas@caribe.example').catch(()=>{});
  await P.getByRole('button', { name: /Guardar/ }).first().click(); await page.waitForTimeout(2500);
  console.log('GUARDAR', await page.locator('[role=alert], .toast').allInnerTexts(), page.url());
  await shot(page, 'F-prov-3-guardado');
  console.log(log.req.filter(r => /supplier|vendor/.test(r) && !/GET/.test(r)).join('\n'));
  // factura de proveedor
  await nav(page, 'Compras', 'Facturas');
  await P.locator('a, button').filter({ hasText: /Nueva factura/ }).first().click(); await page.waitForTimeout(3000);
  await shot(page, 'F-fprov-1-form');
  console.log('FPROV:', (await P.innerText()).slice(0, 1500).replace(/\n+/g, ' | '));
  await browser.close();
})();
