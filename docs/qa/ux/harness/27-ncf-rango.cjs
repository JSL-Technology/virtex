const { launch, login, shot, instrument, fields } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await page.evaluate(() => { location.hash = 'settings/fiscal'; }); await page.waitForTimeout(3500);
  const sec = page.getByText('Rangos de comprobantes autorizados').locator('xpath=ancestor::*[.//button][1]');
  console.log(JSON.stringify(await fields(page, sec)));
  // enviar vacío
  await page.getByRole('button', { name: 'Registrar rango' }).click(); await page.waitForTimeout(1500);
  await shot(page, 'F-ncf-1-vacio');
  console.log('ALERT', await page.locator('[role=alert], .toast').allInnerTexts());
  await sec.locator('select').first().selectOption({ label: 'B02 · Factura de Consumo' });
  await page.waitForTimeout(500);
  const inputs = sec.locator('input:visible');
  console.log('n inputs', await inputs.count(), await inputs.evaluateAll(e => e.map(x => x.type + ':' + x.value + ':' + x.placeholder)));
  await sec.getByLabel('Prefijo', { exact: false }).fill('B02').catch(()=>{});
  await sec.getByLabel('Desde', { exact: false }).fill('1');
  await sec.getByLabel('Hasta', { exact: false }).fill('500');
  await sec.getByLabel('Vence el', { exact: false }).fill('2027-12-31');
  await page.getByRole('button', { name: 'Registrar rango' }).click(); await page.waitForTimeout(2500);
  console.log('ALERT2', await page.locator('[role=alert], .toast').allInnerTexts());
  await shot(page, 'F-ncf-2-registrado');
  console.log(log.req.filter(r=>/ncf|fiscal|sequence/.test(r)).join('\n'));
  await browser.close();
})();
