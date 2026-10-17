const { launch, login, shot, instrument, nav, fields } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Ventas', 'Recibos');
  const P = page.locator('.dv-active-group .dv-content-container');
  await shot(page, 'F-cobro-0-lista');
  const btns = await P.locator('a, button').allInnerTexts(); console.log('BOTONES', btns.filter(b=>b.trim()).join(' | '));
  await P.locator('a, button').filter({ hasText: /Nuevo|Registrar/ }).first().click(); await page.waitForTimeout(3000); console.log('URL', page.url()); console.log('DLG', await page.locator('[role=dialog]').allInnerTexts());
  await shot(page, 'F-cobro-1-form');
  console.log(JSON.stringify(await fields(page, P)));
  console.log((await P.innerText()).slice(0, 1500));
  await browser.close();
})();
