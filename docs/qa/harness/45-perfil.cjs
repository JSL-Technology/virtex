const { launch, instrument, uiLogin, shot, netSince, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  await page.evaluate(() => { location.hash = 'settings/my-profile'; }); await page.waitForTimeout(2000);
  const d = page.locator('[role=dialog]').first();
  const b = d.getByRole('button', { name: 'Guardar Cambios' });
  console.log('inicial deshabilitado', await b.isDisabled());
  await d.locator('[formcontrolname=firstName]').fill('Dev QA'); await page.waitForTimeout(300);
  console.log('tras nombre', await b.isDisabled());
  await d.locator('select').first().selectOption({ index: 6 }); await page.waitForTimeout(300);
  console.log('tras cargo', await b.isDisabled());
  await d.locator('[formcontrolname=phone]').fill('+1 809 555 0101'); await page.waitForTimeout(300); console.log('tras telefono', await b.isDisabled());
  const inv = await d.locator('.ng-invalid').evaluateAll((es) => es.map((e) => `${e.tagName}:${e.getAttribute('formcontrolname') || e.className.slice(0, 40)}`));
  console.log('INVALIDOS', JSON.stringify(inv));
  if (!(await b.isDisabled())) { const n = log.requests.length; await b.click(); await page.waitForTimeout(1500); console.log('stepups', await stepUpAll(page)); await page.waitForTimeout(1500); console.log('RED', JSON.stringify(netSince(log, n))); }
  await d.locator('[formcontrolname=firstName]').fill('Dev'); if (!(await b.isDisabled())) { await b.click(); await page.waitForTimeout(1500); await stepUpAll(page); }
  await browser.close();
})();
