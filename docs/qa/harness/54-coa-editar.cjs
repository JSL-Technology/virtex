const { launch, instrument, uiLogin, go, panel, panelText, netSince, stepUpAll, click, fill } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  const p = panel(page);
  await go(page, 'accounting/chart-of-accounts'); await page.waitForTimeout(1500);
  const edits = p.getByRole('button', { name: 'Editar' }).or(p.getByRole('link', { name: 'Editar' })); console.log('EDITAR', await edits.count());
  let n = log.requests.length; await edits.first().click(); await page.waitForTimeout(2000);
  console.log('[coa-editar] url=', page.url().split('/e/')[1], 'red=', netSince(log, n).join(' ; ').slice(0, 300), '|', (await panelText(page)).replace(/\n+/g, ' | ').slice(0, 250));
  for (const t of ['General','Mapeos','Reglas','Avanzado']) { await p.getByRole('button', { name: t }).or(p.getByRole('tab', { name: t })).first().click().catch(() => {}); await page.waitForTimeout(500); const tx = await panelText(page); console.log('TAB', t, /motivo|raz[oó]n|reason/i.test(tx) ? 'TIENE-MOTIVO' : 'sin motivo', tx.replace(/\n+/g, ' | ').slice(tx.indexOf(t), tx.indexOf(t) + 200)); }
  await p.getByRole('button', { name: 'General' }).first().click().catch(() => {});
  n = log.requests.length; await fill(page, 'Descripción', 'QA descripción editada').catch((e) => console.log('nofill', e.message)); await click(page, /Guardar/); await stepUpAll(page); await page.waitForTimeout(1500);
  console.log('[coa-guardar]', netSince(log, n).join(' ; ').slice(0, 300));
  await browser.close();
})();
