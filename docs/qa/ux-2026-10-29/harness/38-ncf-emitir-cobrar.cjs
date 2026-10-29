const lib = require('./flow-lib.cjs'); const { launch, instrument, shot, panel, errors, text, resetThrottle, BASE } = lib;
(async () => {
  resetThrottle();
  const { browser, context } = await launch({ storageState: __dirname + '/state-admin.json' });
  const page = await context.newPage(); const log = instrument(page);
  await page.goto(BASE + '/e/virtex-dev/overview#settings/fiscal'); await page.waitForTimeout(4000);
  const dlg = page.locator('[role=dialog]').last();
  await dlg.getByLabel(/Tipo/).first().selectOption({ label: 'B02 · Factura de Consumo' }); await page.waitForTimeout(500);
  const f = await dlg.locator('input').evaluateAll(es => es.filter(e => e.offsetParent).map(e => (e.labels?.[0]?.innerText || '') + '=' + e.value + ' ph=' + e.placeholder + ' type=' + e.type));
  console.log('campos rango tras elegir tipo:', f);
  await dlg.getByLabel(/Desde/).fill('1'); await dlg.getByLabel(/Hasta/).fill('500');
  const v = dlg.getByLabel(/Vence el/); await v.fill('2027-12-31');
  await dlg.getByRole('button', { name: 'Registrar rango' }).click(); await page.waitForTimeout(2000);
  console.log('rango →', await errors(page)); await shot(page, 'T-do-6-rango');
  console.log((await dlg.innerText()).split('Rangos de comprobantes autorizados')[1]?.split('Certificado digital')[0].replace(/\n{2,}/g, '\n').slice(-700));
  await page.keyboard.press('Escape'); await page.waitForTimeout(1000);
  console.log('modal cerrado con Escape?', !(await dlg.isVisible().catch(() => false)), 'URL', page.url());
  // factura
  await page.goto(BASE + '/e/virtex-dev/invoices/new'); await page.waitForTimeout(3500); const P = panel(page);
  await P.getByLabel(/Cliente/).click(); await page.waitForTimeout(600); await page.locator('[role=option]').first().click(); await page.waitForTimeout(800);
  await P.getByPlaceholder('— Concepto libre —').click(); await page.keyboard.type('QA-Servicio', { delay: 40 }); await page.waitForTimeout(1200); await page.locator('[role=option]').first().click(); await page.waitForTimeout(1200);
  const emit = P.getByRole('button', { name: /Emitir/ }).first(); console.log('emitir enabled', await emit.isEnabled());
  await emit.click(); await page.waitForTimeout(2000);
  const d2 = page.locator('[role=dialog], [role=alertdialog]').last();
  if (await d2.isVisible().catch(() => false)) { console.log('DIALOGO:', (await d2.innerText()).slice(0, 500)); await shot(page, 'T-do-7-confirmar-emision'); await d2.getByRole('button').filter({ hasText: /Emitir|Confirmar/ }).last().click(); await page.waitForTimeout(3500); }
  console.log('emitida →', page.url(), await errors(page)); await shot(page, 'T-do-8-emitida', true);
  console.log((await text(page)).slice(0, 1200));
  const btns = await panel(page).getByRole('button').allInnerTexts(); console.log('acciones detalle:', btns.map(b => b.trim()).filter(Boolean));
  console.log(log.req.filter(r => /invoice|ncf|fiscal|sequence/.test(r)).slice(-8).join('\n'));
  await browser.close();
})();
