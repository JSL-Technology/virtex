const { launch, instrument, uiLogin, snap, go, netSince, api } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v).slice(0, 1200)}`);
async function setAccount(page, q) {
  await page.evaluate(() => { location.hash = 'settings/inventory-policies'; }); await page.waitForTimeout(2500);
  const box = page.locator('.sm-panel').getByRole('combobox', { name: /Ajustes de inventario/ });
  await box.click(); await box.fill(q); await page.waitForTimeout(1300); await page.locator('[role=option]').first().click(); await page.waitForTimeout(400);
  const n = await page.evaluate(() => 0);
  await page.locator('.sm-panel').getByRole('button', { name: 'Guardar cambios' }).click(); await page.waitForTimeout(2000);
  out('alertas guardar ' + q, [...new Set(await page.locator('[role=alert], [role=status]').allInnerTexts())].filter((t) => t && !t.includes('Periodo')));
  out('dialogo confirmacion', await page.locator('[role=alertdialog]').allInnerTexts());
  return box.inputValue();
}
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page); await go(page, 'inventory/adjustments');
  out('nuevo valor', await setAccount(page, '5900'));
  await snap(page, '87-config-guardado');
  out('red', netSince(log).filter((x) => !x.startsWith('GET')));
  const d = await api(page, 'POST', '/inventory/adjustments', { date: '2026-10-29', warehouseId: '1688f859-df1f-4fdc-90c0-3a8feb63869d', reason: 'QA-7734 efecto cuenta', lines: [{ productId: 'da888aaa-a524-409e-8977-ec9c97007e36', quantityChange: -0.25 }] });
  const p = await api(page, 'POST', `/inventory/adjustments/${d.body.id}/post`);
  const je = await api(page, 'GET', `/journal-entries/${p.body.journalEntryId}`);
  out('cuentas del asiento', (je.body.lines || []).map((l) => [l.account?.code || l.accountId, l.debit, l.credit]));
  out('restaurado', await setAccount(page, '5150'));
  // Auditoría del cambio
  const logs = await api(page, 'GET', '/audit/trail?limit=5');
  out('auditoria', [logs.status, JSON.stringify(logs.body).slice(0, 600)]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
