const { session, MX, shot, panel, errors, text, go, resetThrottle } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-mx.json', MX);
  await go(page, 'accounts-payable'); await page.waitForTimeout(500);
  await panel(page).locator('tbody tr').first().click(); await page.waitForTimeout(2500);
  await panel(page).getByRole('button', { name: 'Enviar a aprobación' }).click(); await page.waitForTimeout(2000);
  const d = page.locator('[role=dialog]').last(); if (await d.isVisible().catch(() => false)) { console.log('DLG', (await d.innerText()).slice(0, 300)); await d.getByRole('button').last().click(); await page.waitForTimeout(2000); }
  console.log('enviar →', await errors(page)); console.log((await text(page)).slice(0, 300));
  console.log('acciones', (await panel(page).getByRole('button').allInnerTexts()).map(s => s.trim()).filter(Boolean));
  await shot(page, 'T-ap-4-enviada', true);
  const apr = panel(page).getByRole('button', { name: /Aprobar/ });
  if (await apr.count()) { await apr.first().click(); await page.waitForTimeout(2000); const d2 = page.locator('[role=dialog]').last(); if (await d2.isVisible().catch(() => false)) { console.log('DLG2', (await d2.innerText()).slice(0, 300)); await d2.getByRole('button').last().click(); await page.waitForTimeout(2000); } console.log('aprobar →', await errors(page)); }
  else { await go(page, 'approvals'); console.log('APROBACIONES:', (await text(page)).slice(0, 600)); await shot(page, 'T-ap-5-bandeja'); }
  console.log('acciones2', (await panel(page).getByRole('button').allInnerTexts()).map(s => s.trim()).filter(Boolean));
  console.log(log.req.filter(r => /payable|approv/.test(r)).slice(-6).join('\n'));
  await close();
})();
