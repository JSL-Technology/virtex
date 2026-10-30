// Igual que 12-auditoria.cjs, con los identificadores del formulario rehecho y su confirmación de ruta.
process.env.CAP_DIR = process.env.CAP_DIR || 'capturas-despues';
const { launch, instrument, uiLogin, snap, go, panel, panelText, netSince, api } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v).slice(0, 1500)}`);
const MODE = process.argv[2] || 'vacio';
async function pickAccount(page, i, q) {
  const box = panel(page).locator(`#aa-line-${i}-accountId`);
  await box.click(); await box.fill(q); await page.waitForTimeout(1300);
  const opts = await page.locator('[role=option]').allInnerTexts(); out(`cuentas '${q}'`, opts.slice(0, 6));
  await page.locator('[role=option]').first().click(); await page.waitForTimeout(500);
}
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page);
  await go(page, 'accounting/audit-adjustments'); await page.waitForTimeout(2500);
  out('url', page.url()); out('titulo doc', await page.title());
  await snap(page, `70-aud-lista-${MODE}`);
  out('lista', (await panelText(page)).slice(0, 1200));
  out('filas clicables', await panel(page).locator('tbody tr a, tbody tr[appRowLink], tbody tr[role=link]').count());
  let n = log.requests.length;
  await panel(page).getByRole('button', { name: /Proponer/ }).first().click(); await page.waitForTimeout(2500);
  out('url form', page.url()); out('titulo doc form', await page.title());
  out('tabs', await page.locator('.dv-tab').allInnerTexts());
  out('red apertura', netSince(log, n));
  await snap(page, `71-aud-form-${MODE}`);
  out('form', (await panelText(page)).slice(0, 1500));
  out('opciones ejercicio', await panel(page).locator('#aa-fiscal-year option').allInnerTexts());
  out('opciones diario', (await panel(page).locator('#aa-journal option').allInnerTexts()).length);
  // Totales con decimales flotantes
  await panel(page).locator('input[formcontrolname=debit]').nth(0).fill('0.1');
  await panel(page).locator('input[formcontrolname=debit]').nth(1).fill('0.2');
  await panel(page).locator('input[formcontrolname=credit]').nth(0).fill('1234567.891');
  await page.waitForTimeout(500);
  out('totales', await panel(page).locator('tfoot td.text-right').allInnerTexts());
  await snap(page, `72-aud-totales-${MODE}`);
  n = log.requests.length;
  await panel(page).locator('button[type=submit]').click(); await page.waitForTimeout(1500);
  out('banner', await panel(page).locator('.dr__banner').innerText().catch(() => '-'));
  out('red guardar', netSince(log, n));
  await snap(page, `73-aud-problemas-${MODE}`);
  // axe
  await page.addScriptTag({ path: '/tmp/claude-0/-home-user-virtex/16a56624-fcd2-58a5-a86d-b5fc046524c4/scratchpad/axe/node_modules/axe-core/axe.min.js' });
  out('axe', await page.evaluate(async () => { const root = document.querySelector('.dv-groupview.dv-active-group .dv-content-container'); const r = await axe.run(root, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, ej: v.nodes.slice(0, 4).map((x) => x.target.join(' ')) })); }));
  if (MODE === 'cerrado') {
    for (let i = 0; i < 2; i++) { await panel(page).locator('input[formcontrolname=debit]').nth(i).fill('0'); await panel(page).locator('input[formcontrolname=credit]').nth(i).fill('0'); }
    await panel(page).locator('#aa-fiscal-year').selectOption({ index: 1 });
    await panel(page).locator('#aa-journal').selectOption({ index: 1 });
    await panel(page).locator('#aa-description').fill('QA-7734 Gasto devengado no registrado (auditoría externa)');
    await pickAccount(page, 0, 'gasto'); await panel(page).locator('#aa-line-0-description').fill('QA-7734 gasto');
    await panel(page).locator('input[formcontrolname=debit]').nth(0).fill('1250.5');
    await pickAccount(page, 1, 'acumul'); await panel(page).locator('#aa-line-1-description').fill('QA-7734 pasivo');
    await panel(page).locator('input[formcontrolname=credit]').nth(1).fill('1250.5');
    await page.waitForTimeout(500);
    out('totales cuadrados', await panel(page).locator('tfoot td.text-right').allInnerTexts());
    await snap(page, '74-aud-lleno');
    n = log.requests.length;
    await panel(page).locator('button[type=submit]').click(); await page.waitForTimeout(3500);
    out('dialogo confirmacion?', await page.locator('[role=dialog], [role=alertdialog]').allInnerTexts());
    await snap(page, '74b-aud-ruta-aprobacion');
    await page.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: /Proponer|Enviar|Confirmar/ }).last().click().catch(() => {});
    await page.waitForTimeout(3500);
    out('red proponer', netSince(log, n));
    out('alertas', [...new Set(await page.locator('[role=alert], [role=status]').allInnerTexts())].filter(Boolean));
    out('url tras proponer', page.url());
    await snap(page, '75-aud-tras-proponer');
    out('lista tras', (await panelText(page)).slice(0, 1200));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
