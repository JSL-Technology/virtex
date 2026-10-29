const { session, MX, shot, panel, fields, errors, text, go, resetThrottle } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-mx.json', MX);
  await go(page, 'hcm/employees'); await page.waitForTimeout(2000); await panel(page).getByRole('button', { name: /Nuevo empleado/ }).or(panel(page).getByRole('link', { name: /Nuevo empleado/ })).first().click(); await page.waitForTimeout(2500);
  console.log('EMP URL', page.url()); await shot(page, 'T-emp-1-form', true);
  const d = page.locator('[role=dialog]').last(); const root = (await d.isVisible().catch(() => false)) ? d : panel(page);
  console.log((await root.innerText()).replace(/\n(Afganistán)[\s\S]*?Zimbabue/, '[paises]').slice(0, 1500));
  console.log((await root.locator('input,select,textarea').evaluateAll(es => es.filter(e => e.offsetParent).map(e => (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || '?').replace(/\s+/g, ' ').slice(0, 40) + ' | ph=' + e.placeholder + ' | ' + e.type))).join('\n'));
  await go(page, 'payroll/runs'); await panel(page).getByRole('button', { name: /Nueva nómina/ }).click(); await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Crear' }).click(); await page.waitForTimeout(3000);
  console.log('nomina sin empleados →', page.url(), await errors(page)); await shot(page, 'T-nom-4-creada', true); console.log((await text(page)).slice(0, 900));
  await close();
})();
