const { launch, login, shot, instrument } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await page.evaluate(() => { location.hash = 'settings/fiscal'; }); await page.waitForTimeout(3500);
  await shot(page, 'F-ajustes-2-comprobantes');
  await shot(page, 'F-ajustes-2-comprobantes-full', true);
  const t = await page.locator('body').innerText(); const i = t.indexOf('Extensiones');
  console.log(t.slice(i, i + 3000));
  console.log(log.req.filter(r=>/ 4\d\d| 5\d\d/.test(r)).join('\n'));
  await browser.close();
})();
