const lib = require('./flow-lib.cjs'); const { launch, instrument, shot, panel, fields, errors, text, resetThrottle, BASE } = lib;
const go = async (page, p) => { await page.goto(BASE + '/e/virtex-dev/' + p); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1500); };
(async () => {
  resetThrottle();
  const { browser, context } = await launch({ storageState: __dirname + '/state-admin.json' });
  const page = await context.newPage(); const log = instrument(page);
  await go(page, 'inventory/products/new'); let P = panel(page);
  await P.getByLabel(/Nombre del producto/).fill('QA-Servicio de consultoría DO'); await P.getByLabel('Tipo').selectOption({ index: 1 });
  await P.getByLabel('Precio de venta').fill('1500'); await P.getByRole('button', { name: /Guardar producto/ }).click(); await page.waitForTimeout(2000);
  console.log('prod', await errors(page));
  await go(page, 'invoices/new'); P = panel(page);
  console.log('banner:', (await text(page)).split('Copiar de')[0].slice(0, 600));
  await P.getByLabel(/Cliente/).click(); await page.waitForTimeout(600); await page.locator('[role=option]').first().click(); await page.waitForTimeout(800);
  await P.getByPlaceholder('— Concepto libre —').click(); await page.keyboard.type('QA-Servicio', { delay: 40 }); await page.waitForTimeout(1200); await page.locator('[role=option]').first().click(); await page.waitForTimeout(1000);
  const emit = P.getByRole('button', { name: /Emitir/ }).first(); console.log('emitir enabled', await emit.isEnabled(), 'title', await emit.getAttribute('title'));
  await shot(page, 'T-do-1-factura', true);
  if (await emit.isEnabled()) { await emit.click(); await page.waitForTimeout(1500); await shot(page, 'T-do-2-emitir-click', true); console.log('tras emitir click:', await errors(page), (await page.locator('[role=dialog], [role=alertdialog]').allInnerTexts()).join(' | ').slice(0, 600)); }
  const dlg = page.locator('[role=dialog], [role=alertdialog]').last();
  if (await dlg.isVisible().catch(() => false)) { const b = dlg.getByRole('button', { name: /Emitir|Confirmar|Sí/ }).last(); if (await b.isVisible()) { await b.click(); await page.waitForTimeout(3000); } }
  console.log('URL', page.url(), await errors(page)); await shot(page, 'T-do-3-emitida', true);
  console.log((await text(page)).slice(0, 1800));
  console.log(log.req.filter(r => /invoice|ncf|fiscal/.test(r)).join('\n'));
  await browser.close();
})();
