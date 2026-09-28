const { launch, instrument, uiLogin, shot, netSince, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  await page.evaluate(() => { location.hash = 'settings/my-profile'; }); await page.waitForTimeout(2000);
  const n = log.requests.length;
  await page.locator('[role=dialog]').first().getByRole('button', { name: 'Activar' }).click(); await page.waitForTimeout(2500);
  console.log('stepups', await stepUpAll(page)); await page.waitForTimeout(2500);
  console.log('DIALOGOS', await page.locator('[role=dialog]').count(), JSON.stringify((await page.locator('[role=dialog]').last().innerText()).replace(/\n+/g, ' | ').slice(0, 400)));
  console.log('RED', JSON.stringify(netSince(log, n)));
  await shot(page, 'f-set-2fa-aislado');
  await browser.close();
})();
