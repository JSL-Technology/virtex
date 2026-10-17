const { launch, login, shot, instrument, nav } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Ventas', 'Cotizaciones');
  const P = page.locator('.dv-active-group .dv-content-container');
  await P.locator('a, button').filter({ hasText: 'Nueva cotización' }).first().click(); await page.waitForTimeout(3000);
  await shot(page, 'F-cot-1-form');
  console.log('URL', page.url(), (await P.innerText()).slice(0, 500).replace(/\n+/g, ' | '));
  const cli = P.getByPlaceholder('Buscar o seleccionar…').first();
  await cli.click(); await cli.pressSequentially('QA', { delay: 60 }); await page.waitForTimeout(1500);
  await page.getByRole('option').filter({ hasText: 'Ferretería' }).first().click(); await page.waitForTimeout(1000);
  const art = P.getByPlaceholder(/Sin producto/).first();
  await art.click(); await art.pressSequentially('Martillo', { delay: 60 }); await page.waitForTimeout(1500);
  await page.getByRole('option').filter({ hasText: 'Martillo' }).first().click(); await page.waitForTimeout(1200);
  await shot(page, 'F-cot-2-llena');
  const btns = (await P.locator('button:visible').allInnerTexts()).filter(Boolean); console.log('BOTONES', btns.join(' | '));
  await P.getByRole('button', { name: /Guardar|Crear|Emitir|Enviar/ }).first().click(); await page.waitForTimeout(3000);
  console.log('ALERT', await page.locator('[role=alert], .toast').allInnerTexts(), page.url());
  await shot(page, 'F-cot-3-guardada');
  const btns2 = (await P.locator('button:visible, a:visible').allInnerTexts()).filter(Boolean); console.log('ACCIONES', btns2.join(' | '));
  const conv = P.getByRole('button', { name: /Convertir|Facturar|factura/i }).first();
  if (await conv.count()) { await conv.click(); await page.waitForTimeout(3000); console.log('tras convertir', page.url(), await page.locator('[role=alert], .toast, [role=dialog]').allInnerTexts()); await shot(page, 'F-cot-4-convertida'); }
  console.log(log.req.filter(r => /quote|invoice/.test(r) && !/GET/.test(r)).join('\n'));
  await browser.close();
})();
