const fs = require('fs');
const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser } = await launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES', acceptDownloads: true });
  const page = await context.newPage(); const log = instrument(page);
  process.env.STEPUP_PASS = 'QA3-Pass-Segura-2026!';
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  page.on('download', async (d) => { const f = `/tmp/claude-0/dl-${d.suggestedFilename()}`; await d.saveAs(f); console.log('DOWNLOAD', f); });
  const p = panel(page);
  await go(page, 'reports/fiscal-returns'); await page.waitForTimeout(2500);
  console.log('PAGE', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 1500));
  const btns = await p.getByRole('button').allInnerTexts(); console.log('BTNS', JSON.stringify(btns.filter(Boolean)));
  await shot(page, 'fr-0');
  // Generar octubre 607 y 606 (los primeros botones "Generar" de la fila 2026-10)
  const cells = p.getByRole('button', { name: 'Sin generar' });
  for (const [i, fmt] of [[1, '607'], [0, '606'], [2, '608']]) {
    let n = log.requests.length;
    await p.getByRole('button').filter({ hasText: /Sin generar|Generado|Comprobado|Presentado/ }).nth(i).click(); await page.waitForTimeout(1500);
    const side = (await panelText(page)).replace(/\s+/g, ' '); console.log(`[${fmt}] panel: ${side.slice(side.indexOf('15/11/2026') + 10, side.indexOf('15/11/2026') + 700)}`);
    console.log('   btns', JSON.stringify((await p.getByRole('button').allInnerTexts()).filter((t) => t && !/No aplica|Sin generar/.test(t))));
    const g = p.getByRole('button', { name: /^Generar/ }).first(); if (await g.count()) { n = log.requests.length; await g.click(); await page.waitForTimeout(3000); await stepUpAll(page); console.log(`   generar red=${JSON.stringify(netSince(log, n)).slice(0, 400)} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-200)}"`); }
    const dl = p.getByRole('button', { name: /Descargar/ }).first(); if (await dl.count()) { n = log.requests.length; await dl.click(); await page.waitForTimeout(2500); console.log(`   descargar red=${JSON.stringify(netSince(log, n)).slice(0, 300)}`); }
    await shot(page, `fr-${fmt}`);
  }
  await page.waitForTimeout(2000);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
