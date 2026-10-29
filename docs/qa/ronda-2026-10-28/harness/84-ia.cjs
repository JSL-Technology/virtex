// Funciones de análisis/IA: acción principal de cada página y su efecto.
const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, stepUpAll } = require('./lib.cjs');
const PAGES = [['reports/anomalies', /Revisar ahora/], ['reports/manager-report', /Generar|Redactar|Crear/], ['inventory/predictions', /Recalcular|Calcular|Actualizar/], ['accounting/treasury/cash-flow', /Recalcular/], ['collections', /Actualizar/], ['accounting/closing/checklist', /Generar|Plan|Asistente|IA|Revisar/], ['reports/relationship-map', /Buscar|Ver/]];
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  process.env.STEPUP_PASS = 'QA3-Pass-Segura-2026!';
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page);
  for (const [r, rx] of PAGES) {
    await go(page, r); await page.waitForTimeout(2000);
    const before = (await panelText(page)).replace(/\s+/g, ' ');
    const b = p.getByRole('button', { name: rx }).first(); const n = log.requests.length;
    let clicked = 'sin botón';
    if (await b.count() && await b.isDisabled()) { clicked = 'DESHABILITADO: ' + (await b.innerText()) + ' title=' + (await b.getAttribute('title')); } else if (await b.count()) { clicked = await b.innerText(); await b.click(); await page.waitForTimeout(6000); await stepUpAll(page); }
    console.log(`\n=== ${r}\n  ANTES: ${before.slice(0, 500)}\n  CLIC: ${clicked} red=${JSON.stringify(netSince(log, n)).slice(0, 500)} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-200)}"\n  DESPUÉS: ${(await panelText(page)).replace(/\s+/g, ' ').slice(0, 700)}`);
    await shot(page, `ia-${r.replace(/\//g, '_')}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
