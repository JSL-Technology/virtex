const { launch, login, shot } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await login(page);
  await page.locator('header').getByText('Dev User').click(); await page.waitForTimeout(700);
  await page.getByText('Atajos de teclado').click(); await page.waitForTimeout(1200);
  await shot(page, 'K-atajos-dialogo');
  console.log((await page.locator('body').innerText()).split('Atajos de teclado').slice(1).join(' ').slice(0, 1500));
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  // Probar el atajo de búsqueda que la app declare
  await page.keyboard.press('Control+KeyK'); await page.waitForTimeout(800);
  await page.keyboard.press('Meta+KeyK'); await page.waitForTimeout(800);
  await page.keyboard.press('/'); await page.waitForTimeout(800);
  console.log('activo:', await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
  await shot(page, 'K-busqueda');
  await browser.close();
})();
