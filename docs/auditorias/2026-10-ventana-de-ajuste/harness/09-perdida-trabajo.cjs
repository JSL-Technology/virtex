const { launch, instrument, uiLogin, snap, go, panel, panelText, netSince, api } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v)}`);
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); instrument(page);
  await uiLogin(page);
  await go(page, 'inventory/adjustments/new'); await page.waitForTimeout(2500);
  out('valor motivo al abrir', await panel(page).locator('#adj-reason').inputValue());
  out('estado tab', await page.locator('.dv-tab.dv-active-tab').innerText().catch(() => ''));
  await panel(page).locator('#adj-reason').fill('QA-7734 borrador que no debe perderse');
  const box = panel(page).locator('tbody tr').nth(0).locator('[role=combobox]');
  await box.fill(''); await box.click(); await box.fill('QA-7734-CAB'); await page.waitForTimeout(1200); await page.locator('[role=option]').first().click(); await page.waitForTimeout(800);
  // foco visible en el combobox de producto
  await box.focus(); await page.waitForTimeout(300);
  await panel(page).locator('tbody tr').first().screenshot({ path: __dirname + '/../capturas/56-foco-producto.png' });
  out('foco producto', await box.evaluate((e) => { const w = e.closest('.vx-select') || e.parentElement; const s = getComputedStyle(w); const si = getComputedStyle(e); return { wrapperOutline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor, wrapperShadow: s.boxShadow, wrapperBorder: s.borderTopColor, inputOutline: si.outlineStyle }; }));
  await panel(page).locator('input[formcontrolname=countedQuantity]').focus();
  await page.waitForTimeout(300);
  out('foco contado', await panel(page).locator('input[formcontrolname=countedQuantity]').evaluate((e) => { const s = getComputedStyle(e); return { outline: s.outlineStyle, shadow: s.boxShadow, border: s.borderTopColor }; }));
  // Escape
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  out('tras Escape motivo', await panel(page).locator('#adj-reason').inputValue().catch(() => 'sin panel'));
  // Cerrar pestaña con cambios
  const tabClose = page.locator('.dv-tab.dv-active-tab').locator('[class*=action], button, [aria-label]').last();
  await page.locator('.dv-tab.dv-active-tab').hover();
  out('acciones tab', await page.locator('.dv-tab.dv-active-tab *').evaluateAll((els) => els.filter((e) => e.getAttribute('aria-label') || e.tagName === 'BUTTON').map((e) => e.tagName + ':' + e.getAttribute('aria-label'))));
  await tabClose.click().catch((e) => out('close err', e.message.split('\n')[0])); await page.waitForTimeout(1000);
  await snap(page, '57-inv-cerrar-pestana-sucia');
  out('dialogo al cerrar', await page.locator('[role=dialog], [role=alertdialog]').allInnerTexts());
  const cancelBtn = page.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: /Cancelar|Seguir|Volver/ }).first();
  if (await cancelBtn.count()) await cancelBtn.click();
  await page.waitForTimeout(800);
  // Recarga completa
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(4000);
  out('url tras recarga', page.url());
  out('motivo tras recarga', await panel(page).locator('#adj-reason').inputValue().catch(() => 'sin campo'));
  out('tab tras recarga', await page.locator('.dv-tab').allInnerTexts());
  await snap(page, '58-inv-tras-recarga');
  // Botón Cancelar con cambios
  await panel(page).locator('#adj-reason').fill('QA-7734 cancelar con cambios').catch(() => {});
  await panel(page).locator('.dr__cancel').click().catch(() => {}); await page.waitForTimeout(1200);
  out('tras Cancelar url', page.url());
  out('dialogo cancelar', await page.locator('[role=dialog], [role=alertdialog]').allInnerTexts());
  await snap(page, '59-inv-cancelar-sucio');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
