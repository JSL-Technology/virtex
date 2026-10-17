const { launch, login, shot, nav } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await login(page);
  await page.keyboard.press('Control+KeyE'); await page.waitForTimeout(800);
  console.log('Ctrl+E activo:', await page.evaluate(() => document.activeElement?.getAttribute('placeholder') || document.activeElement?.tagName));
  await page.keyboard.press('Escape');
  const tabs0 = await page.locator('.dv-tab').count();
  // Usuario escribe en Notas de una factura un texto con "]" usando AltGr (Ctrl+Alt) como en teclado español/LatAm en Windows
  await nav(page, 'Ventas', 'Facturas');
  const P = page.locator('.dv-active-group .dv-content-container');
  await P.locator('a, button').filter({ hasText: 'Nueva factura de venta' }).first().click(); await page.waitForTimeout(2500);
  const tabs1 = await page.locator('.dv-tab').count();
  const notes = P.getByLabel('Notas', { exact: false }).first();
  await notes.click(); await notes.type('Ref [pedido 55', { delay: 30 });
  await page.keyboard.press('Control+Alt+BracketRight'); // AltGr + ] 
  await page.waitForTimeout(1500);
  const tabs2 = await page.locator('.dv-tab').count();
  console.log('pestañas antes', tabs0, 'con factura', tabs1, 'tras AltGr+]', tabs2, 'URL', page.url());
  console.log('valor notas:', await notes.inputValue().catch(() => 'n/a (campo ya no existe)'));
  await shot(page, 'K-altgr-cierra-pestanas');
  await browser.close();
})();
