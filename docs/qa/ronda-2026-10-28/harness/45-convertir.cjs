const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page);
  await go(page, 'quotes'); await page.waitForTimeout(1500); console.log('LISTA', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 300));
  await p.locator('tbody tr').first().click(); await page.waitForTimeout(2500);
  const tabs0 = await page.locator('.dv-tab').count(); const n = log.requests.length;
  await p.getByRole('button', { name: 'Convertir en factura' }).click(); await page.waitForTimeout(3000);
  const d = page.locator('[role=dialog]').last();
  console.log('URL', page.url().split('/e/')[1], 'tabs', tabs0, '→', await page.locator('.dv-tab').count(), 'DLG', (await d.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300), 'red', JSON.stringify(netSince(log, n)).slice(0, 500));
  { const n2 = log.requests.length; await d.getByRole('button', { name: 'Convertir en factura' }).click(); await page.waitForTimeout(3500); console.log('CONFIRMADO url', page.url().split('/e/')[1], 'red', JSON.stringify(netSince(log, n2)).slice(0, 600)); }
  console.log('UI', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 600));
  await shot(page, 'cot-convertir');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
