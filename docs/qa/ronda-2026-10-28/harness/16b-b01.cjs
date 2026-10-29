const { launch, instrument, uiLogin, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page);
  await page.evaluate(() => { location.hash = 'settings/fiscal'; }); await page.waitForTimeout(2500);
  const dlg = page.locator('[role=dialog]').last();
  for (const [t, p] of [['B01 · Factura de Crédito Fiscal', 'B01'], ['B11 · Comprobante de Compras', 'B11']]) {
    await dlg.locator('select[formcontrolname=type]').selectOption({ label: t });
    await dlg.locator('input[formcontrolname=prefix]').fill(p); await dlg.locator('input[formcontrolname=startsAt]').fill('1'); await dlg.locator('input[formcontrolname=endsAt]').fill('500'); await dlg.locator('input[type=date]').first().fill('2027-12-31');
    const n = log.requests.length; await dlg.getByRole('button', { name: 'Registrar rango' }).click(); await page.waitForTimeout(1500); console.log(p, netSince(log, n));
  }
  await browser.close();
})();
