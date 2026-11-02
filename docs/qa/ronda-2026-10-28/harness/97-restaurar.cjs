const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page); await go(page, 'inventory/categories'); await page.waitForTimeout(1500);
  await p.getByText('Mostrar retiradas').click(); await page.waitForTimeout(1500);
  console.log((await panelText(page)).replace(/\s+/g, ' ').slice(0, 300));
  const n = log.requests.length; const b = p.getByRole('button', { name: /Reactivar|Restaurar|Activar/ }).first(); console.log('btn', await b.count()); if (await b.count()) await b.click(); await page.waitForTimeout(2000);
  console.log(JSON.stringify(netSince(log, n)), (await panelText(page)).replace(/\s+/g, ' ').slice(0, 300));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
