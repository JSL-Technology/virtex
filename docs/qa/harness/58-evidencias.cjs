// Evidencias dedicadas: A-01 (un error en step-up expulsa y bloquea) y A-06 (contrapartida vacía).
const { launch, instrument, uiLogin, shot, go, fill, panel, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  const p = panel(page);
  // A-06
  await go(page, 'accounting/treasury/bank-accounts/new');
  await fill(page, 'Nombre', 'QA-Evidencia contrapartida'); await fill(page, 'Saldo inicial', '100000'); await page.waitForTimeout(600);
  const cp = await p.locator('select').last().evaluate((s) => [...s.options].map((o) => o.text.trim()));
  console.log('A06 opciones contrapartida:', JSON.stringify(cp));
  await p.locator('select').last().scrollIntoViewIfNeeded(); await shot(page, 'A06-contrapartida-vacia');
  // A-01 sobre una acción de solo lectura protegida (ver SSO)
  await page.evaluate(() => { location.hash = 'settings/sso'; }); await page.waitForTimeout(2500);
  const pwd = page.getByPlaceholder('Ingresa tu contraseña actual').last();
  await pwd.waitFor({ timeout: 5000 });
  const n = log.requests.length;
  await pwd.fill('incorrecta-123'); await page.getByRole('button', { name: 'Confirmar' }).last().click(); await page.waitForTimeout(2500);
  console.log('A01 tras 1 error:', netSince(log, n).map((x) => x.slice(0, 100)).join(' ; '), '| url=', page.url().split('4200')[1]);
  await shot(page, 'A01-stepup-1-error');
  const pwd2 = page.getByPlaceholder('Ingresa tu contraseña actual').last();
  if (await pwd2.count()) { await pwd2.fill('QA-Test-Pass-2026'); await page.getByRole('button', { name: 'Confirmar' }).last().click(); await page.waitForTimeout(2500); }
  console.log('A01 tras contraseña correcta:', netSince(log, n).map((x) => x.slice(0, 100)).join(' ; ').slice(-400), '| url=', page.url().split('4200')[1]);
  await shot(page, 'A01-stepup-2-bloqueo');
  await browser.close();
})();
