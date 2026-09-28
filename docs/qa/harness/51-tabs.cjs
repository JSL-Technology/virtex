const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  const p = panel(page);
  await go(page, 'invoices/new'); await page.waitForTimeout(1500);
  const a = (await panelText(page)).length;
  await p.getByRole('button', { name: 'Fiscal y cobro' }).or(p.getByText('Fiscal y cobro', { exact: true })).first().click(); await page.waitForTimeout(1000);
  const t = await panelText(page);
  console.log('FISCAL', a, '->', t.length, t.slice(t.indexOf('Fiscal y cobro')).replace(/\n+/g, ' | ').slice(0, 500));
  await shot(page, 'f-tab-fiscal');
  await go(page, 'hcm/employees'); const n = log.requests.length;
  await p.locator('input[type=checkbox]').first().check(); await page.waitForTimeout(1500);
  console.log('DESVINCULADOS red=', JSON.stringify(netSince(log, n)), (await panelText(page)).replace(/\n+/g, ' | ').slice(0, 200));
  await browser.close();
})();
