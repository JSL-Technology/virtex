const { launch, instrument, uiLogin, go, panel, panelText, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page); await go(page, 'masters/warehouses'); await page.waitForTimeout(1500);
  console.log('ANTES', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 300));
  const row = p.locator('tbody tr').filter({ hasText: 'Almacén principal' }); const b = row.getByRole('button', { name: 'Hacer predeterminado' });
  if (await b.count()) { await b.click(); await page.waitForTimeout(2000); }
  console.log('DESPUÉS', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 300));
  await go(page, 'accounting/reconciliation'); await page.waitForTimeout(2000);
  console.log('CONC', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 900));
  console.log(JSON.stringify(await p.locator('input, select').evaluateAll((es) => es.map((e) => `${e.type}:${e.getAttribute('formcontrolname') || e.name || ''}=${e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value}`))));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
