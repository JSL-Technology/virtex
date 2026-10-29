const { session, ADMIN, shot, panel, errors, text, resetThrottle, BASE } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, context, log, close } = await session('state-admin.json', ADMIN);
  // 1) 500 en el listado
  await page.route('**/api/v1/invoices?**', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"statusCode":500,"messageKey":"errors.internal"}' }));
  await page.goto(BASE + '/e/virtex-dev/invoices'); await page.waitForTimeout(4000);
  console.log('500 lista →', (await text(page)).slice(0, 300).replace(/\n+/g, ' | '), '| toasts', await errors(page)); await shot(page, 'N-1-lista-500');
  await page.unroute('**/api/v1/invoices?**');
  // 2) lento (25 s)
  await page.route('**/api/v1/customers**', async r => { await new Promise(x => setTimeout(x, 25000)); r.continue().catch(() => {}); });
  await page.goto(BASE + '/e/virtex-dev/contacts/customers'); await page.waitForTimeout(3000);
  console.log('lento a 3s →', (await text(page)).slice(0, 200).replace(/\n+/g, ' | '), '| skeleton/spinner', await page.evaluate(() => document.querySelectorAll('.dv-groupview.dv-active-group [class*=skeleton],.dv-groupview.dv-active-group [class*=spinner],.dv-groupview.dv-active-group [class*=loading],[aria-busy=true]').length)); await shot(page, 'N-2-lento-3s');
  await page.waitForTimeout(12000); await shot(page, 'N-3-lento-15s'); console.log('lento a 15s →', (await text(page)).slice(0, 200).replace(/\n+/g, ' | '));
  await page.unroute('**/api/v1/customers**');
  // 3) sin conexión al guardar un cliente
  await page.goto(BASE + '/e/virtex-dev/contacts/customers/new'); await page.waitForTimeout(3000);
  await panel(page).getByLabel(/Nombre del cliente/).fill('QA-Offline cliente');
  await context.setOffline(true); await page.waitForTimeout(1500); await shot(page, 'N-4-offline');
  console.log('indicador offline:', (await page.locator('footer, .status-bar, [class*=status]').last().innerText().catch(() => '')).replace(/\n+/g, ' | '));
  await panel(page).getByRole('button', { name: /Guardar cliente/ }).click(); await page.waitForTimeout(3000);
  console.log('guardar offline →', await errors(page), '| valor conservado:', await panel(page).getByLabel(/Nombre del cliente/).inputValue().catch(() => 'n/a')); await shot(page, 'N-5-offline-guardar');
  await context.setOffline(false); await page.waitForTimeout(2000);
  // 4) sesión expirada en mitad del formulario
  await context.clearCookies(); await page.waitForTimeout(500);
  await panel(page).getByRole('button', { name: /Guardar cliente/ }).click(); await page.waitForTimeout(5000);
  console.log('guardar con sesión expirada →', page.url(), await errors(page)); await shot(page, 'N-6-sesion-expirada');
  await close();
})();
