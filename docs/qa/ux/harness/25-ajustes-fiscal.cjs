const { launch, login, shot, instrument, nav } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Ventas', 'Facturas');
  const P = page.locator('.dv-active-group .dv-content-container');
  await P.locator('a, button').filter({ hasText: 'Nueva factura de venta' }).first().click(); await page.waitForTimeout(2500);
  await P.getByText('Ir a la configuración fiscal').click(); await page.waitForTimeout(3000);
  console.log('URL', page.url());
  await shot(page, 'F-ajustes-1-fiscal');
  const dlg = page.locator('[role=dialog]').last();
  console.log((await dlg.innerText().catch(() => page.locator('body').innerText())).slice(0, 3000));
  // listar secciones del modal de ajustes
  const navItems = await page.locator('[role=dialog] nav a, [role=dialog] nav button, [role=dialog] [role=tab]').allInnerTexts().catch(()=>[]);
  console.log('SECCIONES', JSON.stringify(navItems));
  await browser.close();
})();
