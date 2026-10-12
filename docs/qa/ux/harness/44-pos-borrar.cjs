const { launch, login, shot, instrument, nav } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Ventas', 'Punto de venta');
  const P = page.locator('.dv-active-group .dv-content-container');
  await page.waitForTimeout(1500);
  await shot(page, 'F-pos-1');
  console.log('POS:', (await P.innerText()).slice(0, 600).replace(/\n+/g, ' | '));
  const s = P.getByPlaceholder(/Buscar productos/); await s.click(); await s.pressSequentially('Martillo', { delay: 60 }); await page.waitForTimeout(1500);
  await shot(page, 'F-pos-2-busqueda');
  console.log('POS busqueda:', (await P.innerText()).slice(0, 600).replace(/\n+/g, ' | '));
  await P.getByText('QA-UX Martillo', { exact: false }).first().click().catch(e => console.log('no prod click')); await page.waitForTimeout(1200);
  await shot(page, 'F-pos-3-carrito');
  const cobrar = P.getByRole('button', { name: /Cobrar/ });
  console.log('cobrar visible en viewport?', await cobrar.evaluate(e => { const r = e.getBoundingClientRect(); return `${Math.round(r.y)}+${Math.round(r.height)} vs ${innerHeight}`; }).catch(()=>'no'), 'enabled', await cobrar.isEnabled().catch(()=>'?'));
  await cobrar.click().catch(()=>{}); await page.waitForTimeout(2000);
  await shot(page, 'F-pos-4-cobrar');
  console.log('tras cobrar:', (await page.locator('body').innerText()).match(/(turno|caja|shift)[^\n]{0,120}/ig)?.slice(0,3));
  // borrar cliente con factura
  await nav(page, 'Ventas', 'Clientes');
  const row = P.locator('tr', { hasText: 'Ferretería' }).first();
  await row.locator('button').last().click(); await page.waitForTimeout(1500);
  await shot(page, 'F-del-1-confirmacion');
  console.log('CONFIRM:', (await page.locator('[role=dialog], [role=alertdialog]').allInnerTexts()).join(' | '));
  const ok = page.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: /Eliminar|Borrar|Confirmar|Sí/ }).last();
  if (await ok.count()) { await ok.click(); await page.waitForTimeout(2500); }
  console.log('RESULT:', await page.locator('[role=alert], .toast').allInnerTexts());
  await shot(page, 'F-del-2-resultado');
  console.log(log.req.filter(r => /DELETE|customers/.test(r) && !/GET/.test(r)).join('\n'));
  await browser.close();
})();
