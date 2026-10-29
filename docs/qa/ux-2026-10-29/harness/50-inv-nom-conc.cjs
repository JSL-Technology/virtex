const { session, MX, shot, panel, fields, errors, text, go, resetThrottle } = require('./flow-lib.cjs');
const clickNew = async (page, re) => { const b = panel(page).getByRole('button', { name: re }).or(panel(page).getByRole('link', { name: re })).first(); await b.click(); await page.waitForTimeout(2500); };
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-mx.json', MX);
  // Ajuste de inventario
  await go(page, 'inventory/adjustments'); await clickNew(page, /Nuevo ajuste/);
  console.log('AJUSTE URL', page.url()); await shot(page, 'T-inv-1-ajuste', true);
  console.log((await text(page)).slice(0, 900)); console.log((await fields(page)).join('\n'));
  // Nómina
  await go(page, 'payroll/runs'); await clickNew(page, /Nueva nómina/);
  console.log('\nNOMINA URL', page.url()); await shot(page, 'T-nom-1-nueva', true);
  const d = page.locator('[role=dialog]').last(); const root = (await d.isVisible().catch(() => false)) ? d : panel(page);
  console.log((await root.innerText()).slice(0, 900));
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await go(page, 'payroll/parameters'); await shot(page, 'T-nom-2-parametros-mx', true); console.log('\nPARAMETROS MX:', (await text(page)).slice(0, 900));
  await go(page, 'payroll/concepts'); console.log('\nCONCEPTOS MX:', (await text(page)).slice(0, 700)); await shot(page, 'T-nom-3-conceptos-mx', true);
  // Conciliación
  await go(page, 'accounting/reconciliation'); await shot(page, 'T-conc-1', true); console.log('\nCONCILIACION:', (await text(page)).slice(0, 700));
  await panel(page).getByRole('button', { name: /Importar estado/ }).click(); await page.waitForTimeout(1500); await shot(page, 'T-conc-2-importar', true);
  const d2 = page.locator('[role=dialog]').last(); if (await d2.isVisible().catch(() => false)) console.log('IMPORTAR DLG:', (await d2.innerText()).slice(0, 800));
  await close();
})();
