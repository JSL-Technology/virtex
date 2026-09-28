const { launch, instrument, uiLogin, shot, netSince, BASE, go } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  await go(page, 'invoices');
  await page.locator('header').getByText('Dev User').click(); await page.waitForTimeout(600);
  let n = log.requests.length; await page.getByText('Cerrar Sesión').last().click(); await page.waitForTimeout(2500);
  console.log('[logout]', netSince(log, n).join(' ; ').slice(0, 300), '| url=', page.url().replace(BASE, ''));
  await shot(page, 'f-sec-logout');
  await page.goBack().catch(() => {}); await page.waitForTimeout(2500);
  console.log('[logout-atras] url=', page.url().replace(BASE, ''), '|', (await page.locator('body').innerText()).slice(0, 150).replace(/\n+/g, ' '));
  n = log.requests.length;
  const r = await page.evaluate(async () => (await fetch('http://localhost:3000/api/v1/invoices?limit=1', { credentials: 'include' })).status);
  console.log('[logout-api] GET /invoices tras logout ->', r);
  await browser.close();
})();
