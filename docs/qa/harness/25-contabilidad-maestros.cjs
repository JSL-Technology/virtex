// Contabilidad: alta de cuenta (vacío/duplicado/válido), abrir diario de la lista, períodos, cierres (solo lectura),
// multilibros, auxiliares, ajustes de auditoría, análisis de variaciones.
const { launch, instrument, uiLogin, shot, go, fill, click, panel, panelText, netSince, errorsShown, stepUp } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.dismiss(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); console.log(`[${name}] url=${page.url().split('/e/')[1]} errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n))}\n   texto=${(await panelText(page)).replace(/\n+/g, ' | ').slice(0, 500)}\n   botones=${JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean).slice(0, 15))}`); await shot(page, `f-cnt-${name}`); };
  await go(page, 'accounting/chart-of-accounts/new');
  const labels = await p.locator('label').allInnerTexts();
  console.log('LABELS', JSON.stringify(labels));
  await step('coa-1-vacio', async () => { await click(page, /Guardar/); });
  await step('coa-2-duplicado', async () => { await fill(page, 'Código', '5900').catch(() => {}); await fill(page, 'Nombre', 'QA-Cuenta duplicada').catch(() => {}); await click(page, /Guardar/); console.log('STEPUP', JSON.stringify(await stepUp(page))); });
  await step('coa-3-valido', async () => { await fill(page, 'Código', '5910').catch((e) => console.log(e.message)); await fill(page, 'Nombre', 'QA-Gastos de prueba').catch((e) => console.log(e.message)); await click(page, /Guardar/); console.log('STEPUP', JSON.stringify(await stepUp(page))); });
  await go(page, 'accounting/journals');
  await step('diarios-abrir', async () => { await p.locator('tbody tr').first().click(); await page.waitForTimeout(2000); });
  for (const r of ['accounting/periods', 'accounting/closing/checklist', 'accounting/closing/month-end', 'accounting/closing/annual-close', 'accounting/ledgers', 'accounting/subsidiary-ledgers', 'accounting/audit-adjustments', 'accounting/variance-analysis', 'accounting/chart-of-accounts/segments-configuration']) {
    await go(page, r); await step(r.replace(/\//g, '_'), async () => {});
  }
  await go(page, 'accounting/general-ledger');
  await step('mayor-cuenta', async () => { const cb = p.locator('input[role=combobox], select').first(); await cb.click({ force: true }); await page.keyboard.type('1120'); await page.waitForTimeout(1200); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(2000); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
