const { launch, shot, ADMIN } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await page.goto('http://localhost:4200/es/auth/login', { waitUntil: 'load' }); await page.waitForTimeout(2500);
  await page.locator('input[type=email]').fill(ADMIN.email); await page.locator('input[type=password]').fill(ADMIN.password);
  await page.locator('button[type=submit]').click(); await page.waitForTimeout(2500);
  console.log('Con contraseña CORRECTA y cuenta bloqueada:', await page.locator('[role=alert], .toast, .error, .alert').allInnerTexts());
  await shot(page, 'A-err-5-bloqueada-con-clave-correcta');
  await browser.close();
})();
