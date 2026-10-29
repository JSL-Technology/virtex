const { session, ADMIN, shot, panel, text, resetThrottle, BASE } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-admin.json', ADMIN);
  // 1) borrador nuevo en DO, sin guardar
  await page.goto(BASE + '/e/virtex-dev/invoices/new'); await page.waitForTimeout(3500);
  const P = panel(page);
  await P.getByLabel(/Cliente/).click(); await page.waitForTimeout(600); await page.locator('[role=option]').first().click(); await page.waitForTimeout(600);
  await P.getByPlaceholder('— Concepto libre —').click(); await page.keyboard.type('QA-Servicio', { delay: 40 }); await page.waitForTimeout(1200); await page.locator('[role=option]').first().click(); await page.waitForTimeout(1500);
  console.log('DO borrador estado:', (await text(page)).split('\n').slice(0, 4).join(' | '), '| total', (await text(page)).match(/Total\n(.*)/)?.[1]);
  // 2) cambiar de empresa con el selector
  await page.locator('aside.main-sidebar').getByText('Virtex Dev').first().click(); await page.waitForTimeout(1000);
  await shot(page, 'O-8-cambio-con-borrador');
  const dlgBefore = await page.locator('[role=dialog], [role=alertdialog]').count();
  await page.getByText(/QA-UX3 Comercializadora/).first().click(); await page.waitForTimeout(2500);
  const d = page.locator('[role=dialog], [role=alertdialog]').last(); const warned = await d.isVisible().catch(() => false);
  console.log('¿avisa de cambios sin guardar al cambiar de empresa?', warned, warned ? (await d.innerText()).slice(0, 200) : '');
  await page.waitForTimeout(2000); console.log('URL', page.url());
  // 3) volver a DO
  await page.locator('aside.main-sidebar').getByText(/QA-UX3/).first().click(); await page.waitForTimeout(1000);
  await page.getByText('Virtex Dev', { exact: true }).last().click(); await page.waitForTimeout(4000);
  await page.locator('.dv-tab').filter({ hasText: 'Nueva factura' }).first().click(); await page.waitForTimeout(3000);
  console.log('DO al volver:', (await text(page)).split('\n').slice(0, 4).join(' | '), '| total', (await text(page)).match(/Total\n(.*)/)?.[1]);
  await shot(page, 'O-9-borrador-al-volver');
  await close();
})();
