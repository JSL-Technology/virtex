const { session, MX, shot, panel, errors, text, go, resetThrottle } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-mx.json', MX);
  await go(page, 'accounting/reconciliation'); await panel(page).getByText('Importar estado de cuenta').click(); await page.waitForTimeout(2000);
  const P = panel(page);
  await P.locator('input[type=file]').setInputFiles(__dirname + '/qa-extracto.csv'); await page.waitForTimeout(800);
  console.log('tras archivo, ¿autodetecta columnas?', await P.getByLabel(/Columna de fecha/).inputValue(), '|', await P.getByLabel(/Columna de concepto/).inputValue());
  await P.getByLabel(/^Desde/).fill('2026-10-01'); await P.getByLabel(/^Hasta/).fill('2026-10-31');
  await P.getByLabel(/Saldo inicial/).fill('0'); await P.getByLabel(/Saldo final/).fill('-8000');
  console.log('monto auto', await P.getByLabel(/Columna de monto/).inputValue().catch(()=>'?'));
  await shot(page, 'T-conc-3-import-lleno', true);
  await P.getByRole('button', { name: 'Importar estado de cuenta' }).click(); await page.waitForTimeout(4000);
  const sd = page.locator('[role=dialog]').last(); if (await sd.isVisible().catch(() => false)) { const pw = sd.locator('input[type=password]'); if (await pw.count()) { await pw.fill('QA-Test-Pass-2026!'); await sd.getByRole('button', { name: 'Confirmar' }).click(); await page.waitForTimeout(4000); console.log('step-up en importación'); } }
  console.log('import →', page.url(), await errors(page)); await shot(page, 'T-conc-4-tras-import', true);
  console.log((await text(page)).slice(0, 1500).replace(/\n+/g, ' | '));
  console.log(log.req.filter(r => /statement|reconcil|bank/.test(r)).slice(-6).join('\n'));
  await close();
})();
