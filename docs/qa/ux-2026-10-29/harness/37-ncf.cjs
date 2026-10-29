const lib = require('./flow-lib.cjs'); const { launch, instrument, shot, errors, resetThrottle, BASE } = lib;
(async () => {
  resetThrottle();
  const { browser, context } = await launch({ storageState: __dirname + '/state-admin.json' });
  const page = await context.newPage(); const log = instrument(page);
  await page.goto(BASE + '/e/virtex-dev/invoices/new'); await page.waitForTimeout(3500);
  await page.getByText('Ir a la configuración fiscal').click(); await page.waitForTimeout(2000);
  const dlg = page.locator('[role=dialog]').last();
  await dlg.getByText('Comprobantes fisca').click(); await page.waitForTimeout(2500);
  console.log('URL', page.url()); await shot(page, 'T-do-5-comprobantes');
  const body = dlg.locator('main, .settings-content, [class*=content]').last();
  console.log((await dlg.innerText()).split('Extensiones')[1].replace(/\n{2,}/g, '\n').slice(0, 3000));
  const btns = await dlg.getByRole('button').allInnerTexts(); console.log('BOTONES', btns.filter(Boolean).slice(-15));
  await browser.close();
})();
