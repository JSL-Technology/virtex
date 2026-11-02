const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page);
  const p = panel(page);
  // Reactivar producto
  await go(page, 'inventory/products'); await page.waitForTimeout(1500);
  console.log('LISTA', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 500));
  const tog = p.locator('label, button').filter({ hasText: /inactiv|retirad|desactivad/i }).first(); if (await tog.count()) { await tog.click(); await page.waitForTimeout(1200); console.log('CON-INACTIVOS', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 500)); }
  await p.locator('tbody tr').filter({ hasText: 'QA3-7734' }).first().click(); await page.waitForTimeout(2500);
  let n = log.requests.length;
  await p.locator('[formcontrolname=status]').selectOption({ label: 'Activo' }); await p.getByRole('button', { name: /Guardar/ }).first().click(); await page.waitForTimeout(2000);
  console.log('[reactivar]', JSON.stringify(netSince(log, n)).slice(0, 300), (await toasts(page)).replace(/\s+/g, ' ').slice(-120));
  // Borrar proveedor sin docs (fila sin nombre por el bug de la lista)
  await go(page, 'contacts/suppliers'); await page.waitForTimeout(1500);
  const row = p.locator('tbody tr').first(); n = log.requests.length;
  await row.locator('button').last().click(); await page.waitForTimeout(1000);
  const d = page.locator('[role=dialog]').last(); console.log('[prov] confirm', (await d.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 250)); await shot(page, 'del-prov-sin-nombre');
  await d.getByRole('button').filter({ hasText: /Eliminar/ }).last().click().catch(() => {}); await page.waitForTimeout(2000);
  console.log('   red', JSON.stringify(netSince(log, n)).slice(0, 300), (await toasts(page)).replace(/\s+/g, ' ').slice(-120));
  // Departamento sin empleados (el duplicado)
  await go(page, 'hcm/departments'); await page.waitForTimeout(1500); n = log.requests.length;
  await p.locator('tbody tr').last().locator('button').last().click(); await page.waitForTimeout(800);
  const d2 = page.locator('[role=dialog]').last(); await d2.getByRole('button', { name: 'Eliminar' }).click().catch(() => {}); await page.waitForTimeout(2000);
  console.log('[depto]', JSON.stringify(netSince(log, n)).slice(0, 300), (await panelText(page)).replace(/\s+/g, ' ').slice(0, 200));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
