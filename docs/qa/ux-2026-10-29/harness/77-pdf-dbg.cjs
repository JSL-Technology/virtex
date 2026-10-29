const { session, ADMIN, shot, panel, errors, resetThrottle, BASE } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, context, log, close } = await session('state-admin.json', ADMIN);
  page.on('popup', p => console.log('POPUP', p.url()));
  await page.goto(BASE + '/e/virtex-dev/invoices'); await page.waitForTimeout(3500);
  await panel(page).locator('tbody tr').filter({ hasText: 'B0200000001' }).first().click(); await page.waitForTimeout(3000);
  log.req.length = 0; log.console.length = 0;
  await panel(page).getByRole('button', { name: 'PDF' }).click(); await page.waitForTimeout(6000);
  console.log('PDF req:', log.req.join(' ; ').slice(0, 600)); console.log('consola', log.console.slice(0, 3), log.errors.slice(0, 2)); console.log('toasts', await errors(page));
  await shot(page, 'D-pdf-tras-6s');
  log.req.length = 0;
  await page.evaluate(() => { window.print = () => console.log('PRINT_CALLED'); });
  page.on('console', m => m.text() === 'PRINT_CALLED' && console.log('print llamado'));
  await panel(page).getByRole('button', { name: 'Imprimir' }).click(); await page.waitForTimeout(5000);
  console.log('Imprimir req:', log.req.join(' ; ').slice(0, 400)); await shot(page, 'D-imprimir-tras-5s');
  await close();
})();
