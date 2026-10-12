const { launch, login, shot, instrument, nav, text } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Ventas', 'Clientes');
  const P = page.locator('.dv-active-group .dv-content-container');
  await P.locator('a, button').filter({ hasText: 'Nuevo cliente' }).first().click(); await page.waitForTimeout(2000);
  const save = () => P.locator('button').filter({ hasText: 'Guardar cliente' }).click();
  const byLabel = (l) => P.getByLabel(l, { exact: false }).first();
  // 1. vacío
  await save(); await page.waitForTimeout(1500);
  await shot(page, 'F-cliente-2-vacio'); console.log('VACIO:', (await P.innerText()).split('\n').filter(l => /requerid|obligat|error|inválid|debe/i.test(l)).join(' | '));
  // 2. inválidos
  await byLabel('Nombre del cliente').fill('   ');
  await byLabel('Número de documento').fill('123');
  await byLabel('Correo electrónico').fill('cliente@');
  await byLabel('Teléfono').fill('abc');
  await byLabel('Días de crédito').fill('-5');
  await save(); await page.waitForTimeout(1500);
  await shot(page, 'F-cliente-3-invalido', true); console.log('INVALIDO:', (await P.innerText()).split('\n').filter(l => /requerid|obligat|error|inválid|debe|formato|válid/i.test(l)).join(' | '));
  console.log('toasts:', await page.locator('[role=alert], [role=status], .toast').allInnerTexts());
  // 3. válido con caracteres especiales
  await byLabel('Nombre del cliente').fill('QA-UX Ferretería Núñez & Hijos, S.R.L. <script>alert(1)</script> 😀');
  await byLabel('Persona de contacto').fill("María-José O'Neill");
  await byLabel('Número de documento').fill('');
  await byLabel('Correo electrónico').fill('compras+qa@ferreteria-nunez.do');
  await byLabel('Teléfono').fill('809-555-0101');
  await byLabel('Días de crédito').fill('30');
  await byLabel('Línea de dirección').fill('Av. 27 de Febrero #1234, Ensanche Piantini');
  await byLabel('Ciudad').fill('Santo Domingo');
  await save(); await page.waitForTimeout(3000);
  await shot(page, 'F-cliente-4-guardado'); console.log('URL tras guardar', page.url());
  console.log('toasts:', await page.locator('[role=alert], [role=status], .toast, .toast-container').allInnerTexts());
  console.log(log.req.filter(r => /customer|contact/.test(r)).join('\n'));
  await browser.close();
})();
