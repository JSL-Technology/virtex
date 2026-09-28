// Verificación manual de elementos que la pasada automática marcó "sin efecto": se prueban en pestaña limpia,
// detectando descargas, menús, diálogos, navegación y red.
const fs = require('fs');
const path = require('path');
const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, BASE } = require('./lib.cjs');
const CASES = [
  ['reports/financial-statements/balance-sheet', { role: 'button', name: 'Exportar' }],
  ['reports/financial-statements/income-statement', { role: 'button', name: 'Exportar' }],
  ['reports/financial-statements/trial-balance', { role: 'button', name: 'Exportar' }],
  ['reports/financial-statements/cash-flow', { role: 'button', name: 'Exportar' }],
  ['reports/profitability-by-product', { role: 'button', name: 'Exportar' }],
  ['accounting/daily-journal', { role: 'button', name: 'Exportar' }],
  ['accounting/chart-of-accounts', { role: 'button', name: 'Exportar' }],
  ['accounting/general-ledger', { role: 'button', name: 'Exportar' }],
  ['sales/history', { role: 'button', name: 'Exportar' }],
  ['invoices', { role: 'button', name: 'Exportar' }],
  ['accounting/journal-entries', { text: 'GENERAL-2026-000001' }],
  ['accounting/journal-entries', { role: 'link', name: 'Más acciones' }],
  ['inventory/products', { text: 'QA-Producto-01 Silla ergonómica' }],
  ['contacts/customers', { text: 'QA-Cliente-01 Distribuidora Ñandú & Hijos' }],
  ['reports/aging/receivables', { text: 'QA-Cliente-01 Distribuidora Ñandú & Hijos' }],
  ['unauthorized', { text: 'Solicitar Permiso' }],
  ['accounting/journal-entries/import', { text: 'Haz clic aquí para seleccionar' }],
  ['masters/taxes', { text: 'ITBIS 18%' }],
];
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await page.addInitScript(() => { window.__opens = []; window.open = (u) => { window.__opens.push(String(u)); return null; }; });
  await uiLogin(page);
  const p = panel(page);
  let i = 0;
  for (const [route, sel] of CASES) {
    i++;
    // pestaña limpia: cerrar todo salvo Inicio
    for (let k = 0; k < 8; k++) { const n = await page.locator('.dv-tab').count(); if (n <= 1) break; const t = page.locator('.dv-tab').nth(n - 1); await t.hover(); await t.locator('[class*=close]').first().click().catch(() => {}); await page.waitForTimeout(250); const disc = page.getByRole('button', { name: 'Descartar' }); if (await disc.count()) await disc.click(); }
    await go(page, route); await page.waitForTimeout(1500);
    const before = { url: page.url(), tabs: await page.locator('.dv-tab').count() };
    const n = log.requests.length;
    const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    const fc = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null);
    try {
      const loc = sel.role ? p.getByRole(sel.role, { name: sel.name }) : p.getByText(sel.text, { exact: false });
      await loc.first().click({ timeout: 5000 });
    } catch (e) { console.log(`#${i} ${route} ${JSON.stringify(sel)} NO-INTERACTUABLE ${e.message.split('\n')[0]}`); continue; }
    await page.waitForTimeout(2000);
    const d = await dl; const f = await fc;
    const after = { url: page.url(), tabs: await page.locator('.dv-tab').count() };
    const overlay = (await page.locator('[role=menu], [role=dialog], .cdk-overlay-pane').allInnerTexts()).join(' / ').replace(/\n+/g, ' ').slice(0, 160);
    const opens = await page.evaluate(() => window.__opens);
    console.log(`#${i} ${route} ${JSON.stringify(sel)} -> descarga=${d ? d.suggestedFilename() : '-'} selectorArchivo=${!!f} url=${after.url !== before.url ? after.url.replace(BASE, '') : '='} pestañas=${before.tabs}->${after.tabs} overlay="${overlay}" window.open=${JSON.stringify(opens)} red=${netSince(log, n).map((x) => x.slice(0, 90)).join(' ; ').slice(0, 300)}`);
    if (d) { const out = path.join(__dirname, '..', 'evidence', 'tmp', d.suggestedFilename()); await d.saveAs(out).catch(() => {}); console.log('   contenido:', fs.existsSync(out) ? fs.readFileSync(out).slice(0, 160).toString().replace(/\n/g, ' ⏎ ') : ''); }
    await page.keyboard.press('Escape');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
