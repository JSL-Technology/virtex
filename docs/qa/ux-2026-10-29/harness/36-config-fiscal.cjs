const lib = require('./flow-lib.cjs'); const { launch, instrument, shot, panel, fields, errors, text, resetThrottle, BASE } = lib;
(async () => {
  resetThrottle();
  const { browser, context } = await launch({ storageState: __dirname + '/state-admin.json' });
  const page = await context.newPage(); const log = instrument(page);
  await page.goto(BASE + '/e/virtex-dev/invoices/new'); await page.waitForTimeout(3500);
  await page.getByText('Ir a la configuración fiscal').click(); await page.waitForTimeout(2500);
  console.log('URL', page.url()); await shot(page, 'T-do-4-config-fiscal', true);
  const dlg = page.locator('[role=dialog]').last();
  const t = await (await dlg.isVisible().catch(() => false) ? dlg : page.locator('body')).innerText();
  console.log(t.replace(/\n{2,}/g, '\n').slice(0, 3500));
  console.log(log.req.slice(-6).join('\n'));
  await browser.close();
})();
