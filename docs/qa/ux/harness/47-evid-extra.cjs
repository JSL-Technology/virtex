const { launch, login, shot } = require('./lib.cjs');
(async () => {
  // 1) Pantalla en blanco: /auth/session nunca responde (lo observado durante el cuelgue del API)
  let { browser, context } = await launch();
  let page = await context.newPage();
  await login(page);
  await context.route('**/api/v1/auth/session', () => { /* nunca responde */ });
  await page.goto('http://localhost:4200/e/virtex-dev/invoices', { waitUntil: 'load' }).catch(()=>{});
  await page.waitForTimeout(30000);
  console.log('texto visible tras 30 s:', JSON.stringify((await page.locator('body').innerText()).trim().slice(0, 80)));
  await shot(page, 'C02-pantalla-en-blanco-30s');
  await browser.close();
  // 2) Registro desde México y Colombia
  ({ browser, context } = await launch({ locale: 'es-MX' }));
  page = await context.newPage();
  await page.goto('http://localhost:4200/es/auth/login', { waitUntil: 'load' }); await page.waitForTimeout(2500);
  const href = await page.locator('a[href*="register"]').first().getAttribute('href');
  await page.locator('a[href*="register"]').first().click(); await page.waitForTimeout(3000);
  console.log('MX: enlace', href, '-> URL final', page.url());
  await shot(page, 'C03-registro-mexico-vuelve-al-login');
  await browser.close();
})();
