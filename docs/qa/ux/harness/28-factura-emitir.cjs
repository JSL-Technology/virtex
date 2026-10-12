const { launch, login, shot, instrument, nav } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Ventas', 'Facturas');
  const P = page.locator('.dv-active-group .dv-content-container');
  await P.locator('a, button').filter({ hasText: 'Nueva factura de venta' }).first().click(); await page.waitForTimeout(3000);
  // cliente
  const cli = P.getByPlaceholder('Busca por nombre, documento o correo…');
  await cli.click(); await cli.type('Ferre', { delay: 60 }); await page.waitForTimeout(1500);
  await shot(page, 'F-fac-2-buscar-cliente');
  await page.getByRole('option').first().click().catch(async () => { await page.getByText('QA-UX Ferretería', { exact: false }).last().click(); });
  await page.waitForTimeout(1500);
  // linea 1
  const art = P.getByPlaceholder('— Concepto libre —').first();
  await art.click(); await art.type('Martillo', { delay: 60 }); await page.waitForTimeout(1500);
  await shot(page, 'F-fac-3-buscar-producto');
  await page.getByRole('option').filter({ hasText: 'Martillo' }).first().click().catch(async () => { await page.getByText('QA-UX Martillo', { exact: false }).last().click(); });
  await page.waitForTimeout(1200);
  const qty = P.locator('table input[type=number], .line input[type=number]').first();
  await qty.fill('2'); await page.keyboard.press('Tab'); await page.waitForTimeout(800);
  // linea 2
  await P.getByText('Agregar línea').click(); await page.waitForTimeout(800);
  const art2 = P.getByPlaceholder('— Concepto libre —').nth(1);
  await art2.click(); await art2.type('instal', { delay: 60 }); await page.waitForTimeout(1500);
  await page.getByRole('option').filter({ hasText: 'instalación' }).first().click().catch(async () => { await page.getByText('QA-UX Servicio de instalación', { exact: false }).last().click(); });
  await page.waitForTimeout(1200);
  await shot(page, 'F-fac-4-lineas');
  await shot(page, 'F-fac-4-lineas-full', true);
  // fiscal tab
  await P.getByText('Fiscal y cobro', { exact: true }).click(); await page.waitForTimeout(1200);
  await shot(page, 'F-fac-5-fiscal');
  console.log('FISCAL TAB:', (await P.innerText()).split('Fiscal y cobro')[1]?.slice(0, 1500));
  await P.getByText('Contenido', { exact: true }).click(); await page.waitForTimeout(800);
  // emitir
  const emit = P.getByRole('button', { name: /Emitir factura/ });
  console.log('emit enabled', await emit.isEnabled());
  await emit.click(); await page.waitForTimeout(2500);
  await shot(page, 'F-fac-6-confirmar');
  console.log('DIALOG', await page.locator('[role=dialog], [role=alertdialog]').allInnerTexts());
  const confirm = page.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: /Emitir|Confirmar|Sí/ }).last();
  if (await confirm.count()) { await confirm.click(); await page.waitForTimeout(4000); }
  await shot(page, 'F-fac-7-emitida');
  await shot(page, 'F-fac-7-emitida-full', true);
  console.log('URL', page.url());
  console.log('ALERTS', await page.locator('[role=alert], .toast').allInnerTexts());
  console.log(log.req.filter(r => /invoice/.test(r) && !/GET/.test(r)).join('\n'));
  console.log(log.req.filter(r => / [45]\d\d /.test(r)).join('\n'));
  await browser.close();
})();
