const { session, MX, shot, panel, errors, text, go, resetThrottle } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-mx.json', MX);
  await go(page, 'payroll/runs'); await page.waitForTimeout(1500); await panel(page).getByRole('button', { name: /Nueva nómina/ }).click(); await page.waitForTimeout(1200);
  await shot(page, 'T-nom-5-dialogo');
  await page.getByRole('button', { name: 'Crear', exact: true }).click(); await page.waitForTimeout(3000);
  console.log('nomina sin empleados →', page.url(), await errors(page)); await shot(page, 'T-nom-6-creada', true); console.log((await text(page)).slice(0, 1200));
  console.log('acciones', (await panel(page).getByRole('button').allInnerTexts()).map(s => s.trim()).filter(Boolean));
  console.log(log.req.filter(r => /payroll/.test(r)).slice(-4).join('\n'));
  await close();
})();
