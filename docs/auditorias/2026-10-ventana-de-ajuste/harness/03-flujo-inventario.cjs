const { launch, instrument, uiLogin, snap, go, panel, panelText, netSince, toasts } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`);
async function pickProduct(page, row, q, idx = 0) {
  const box = panel(page).locator('tbody tr').nth(row).locator('[role=combobox]');
  await box.click(); await box.fill(q); await page.waitForTimeout(1200);
  const opts = await page.locator('[role=option]').allInnerTexts();
  out(`opciones '${q}'`, opts);
  await page.locator('[role=option]').nth(idx).click(); await page.waitForTimeout(1200);
}
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  await go(page, 'inventory/adjustments');
  await page.waitForTimeout(1500);
  let n = log.requests.length;
  await panel(page).getByText('Nuevo ajuste').first().click();
  await page.waitForTimeout(2500);
  out('url nuevo', page.url());
  out('tabs', await page.locator('.dv-tab').allInnerTexts().catch(() => []));
  out('doc title', await page.title());
  await snap(page, '10-inv-nuevo-vacio');
  out('texto', await panelText(page));
  out('red apertura', netSince(log, n));
  // Guardar vacío
  n = log.requests.length;
  await panel(page).locator('button[type=submit]').click(); await page.waitForTimeout(1200);
  await snap(page, '11-inv-guardar-vacio');
  out('problemas', await panel(page).locator('.dr__banner').innerText().catch(() => '-'));
  out('red guardar vacio', netSince(log, n));
  // Llenado
  await panel(page).locator('#adj-warehouse').selectOption({ label: 'QA-7734 Almacén Norte' });
  await panel(page).locator('#adj-reason').fill('QA-7734 Conteo cíclico octubre');
  await pickProduct(page, 0, 'QA-7734-TOR');
  await panel(page).locator('tbody tr').nth(0).locator('input[formcontrolname=countedQuantity]').fill('95');
  await page.waitForTimeout(500);
  await panel(page).getByText('Agregar línea').click(); await page.waitForTimeout(500);
  await pickProduct(page, 1, 'QA-7734-CAB');
  await panel(page).locator('tbody tr').nth(1).locator('input[formcontrolname=quantityChange]').fill('-2.25');
  await panel(page).getByText('Agregar línea').click(); await page.waitForTimeout(500);
  await pickProduct(page, 2, 'tornillo', 1);
  await panel(page).locator('tbody tr').nth(2).locator('input[formcontrolname=newUnitCost]').fill('950');
  await page.waitForTimeout(800);
  await snap(page, '12-inv-borrador-lleno');
  out('banner stale', await panel(page).locator('.dr__banner').innerText().catch(() => '-'));
  out('placeholders cambio', await panel(page).locator('input[formcontrolname=quantityChange]').evaluateAll((els) => els.map((e) => ({ value: e.value, placeholder: e.placeholder }))));
  out('existencias', await panel(page).locator('tbody tr td:nth-child(2)').allInnerTexts());
  n = log.requests.length;
  await panel(page).locator('button[type=submit]').click(); await page.waitForTimeout(2500);
  out('toasts', await toasts(page));
  out('url tras guardar', page.url());
  out('red guardar', netSince(log, n));
  await snap(page, '13-inv-guardado');
  out('texto guardado', await panelText(page));
  // Contabilizar
  await panel(page).getByRole('button', { name: 'Contabilizar' }).click(); await page.waitForTimeout(1000);
  await snap(page, '14-inv-confirmar-contabilizar');
  out('dialogo', await page.locator('[role=dialog], [role=alertdialog]').last().innerText().catch(() => '-'));
  n = log.requests.length;
  await page.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: 'Contabilizar' }).last().click();
  await page.waitForTimeout(3000);
  out('toasts post', await toasts(page));
  out('red post', netSince(log, n));
  await snap(page, '15-inv-contabilizado');
  out('texto contabilizado', await panelText(page));
  out('botones visibles', await panel(page).locator('button:visible').allInnerTexts());
  // Guardar sobre contabilizado
  n = log.requests.length;
  const saveBtn = panel(page).locator('button[type=submit]');
  out('save visible/enabled', { count: await saveBtn.count(), enabled: await saveBtn.isEnabled().catch(() => null) });
  out('inputs habilitados', await panel(page).locator('input:enabled, select:enabled, textarea:enabled').count());
  await saveBtn.click().catch(() => {}); await page.waitForTimeout(2000);
  out('red guardar contabilizado', netSince(log, n));
  out('toasts guardar contabilizado', await toasts(page));
  await snap(page, '16-inv-guardar-sobre-contabilizado');
  console.log('URL_DOC=' + page.url());
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
