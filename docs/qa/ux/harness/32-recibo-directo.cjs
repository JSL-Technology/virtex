const { launch, login, shot, instrument, fields } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await page.evaluate(() => { history.pushState({}, '', '/e/virtex-dev/customer-receipts/new'); dispatchEvent(new PopStateEvent('popstate')); }); await page.waitForTimeout(3500);
  console.log('URL', page.url());
  await shot(page, 'F-cobro-3-directo');
  const P = page.locator('.dv-active-group .dv-content-container');
  console.log(JSON.stringify(await fields(page, P)));
  console.log((await P.innerText()).slice(0, 1500));
  const cli = P.getByPlaceholder('Busca por nombre, documento o correo…'); await cli.click(); await cli.type('Ferre', { delay: 50 }); await page.waitForTimeout(1500);
  await page.getByRole('option').first().click().catch(()=>{}); await page.waitForTimeout(2000);
  const bank = P.getByPlaceholder('Buscar o seleccionar…'); await bank.click(); await page.waitForTimeout(1500);
  console.log('BANK OPTIONS', await page.getByRole('option').allInnerTexts(), await page.locator('.cdk-overlay-container, [role=listbox]').allInnerTexts());
  await shot(page, 'F-cobro-4-cuenta-bancaria');
  console.log((await P.innerText()).split('Facturas a aplicar')[1]?.slice(0, 600));
  await browser.close();
})();
