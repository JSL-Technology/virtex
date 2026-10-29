const { launch, instrument, login, shot, panel, resetThrottle, BASE } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { browser, context } = await launch({ storageState: __dirname + '/state-admin.json' }); const page = await context.newPage();
  await page.goto(BASE + '/e/virtex-dev/contacts/customers/new'); await page.waitForTimeout(3500);
  if (page.url().includes('/auth/')) { await login(page); await page.goto(BASE + '/e/virtex-dev/contacts/customers/new'); await page.waitForTimeout(3000); }
  await panel(page).getByLabel(/Nombre del cliente/).fill('QA-Trabajo en curso 123'); await panel(page).getByLabel('Correo electrónico').fill('qa.wip@example.com'); await page.waitForTimeout(2000);
  await context.clearCookies(); await panel(page).getByRole('button', { name: /Guardar cliente/ }).click(); await page.waitForTimeout(5000);
  console.log('→', page.url());
  await page.locator('input[type=email]').fill('dev@virtex.local'); await page.locator('input[type=password]').fill('QA-Test-Pass-2026'); resetThrottle(); await page.locator('button[type=submit]').click(); await page.waitForTimeout(6000);
  console.log('tras login →', page.url());
  const v = await panel(page).getByLabel(/Nombre del cliente/).inputValue().catch(() => 'n/a'); const e = await panel(page).getByLabel('Correo electrónico').inputValue().catch(() => 'n/a');
  console.log('¿conserva lo escrito?', JSON.stringify({ v, e })); await shot(page, 'N-7-tras-relogin');
  await context.storageState({ path: __dirname + '/state-admin.json' }); await browser.close();
})();
