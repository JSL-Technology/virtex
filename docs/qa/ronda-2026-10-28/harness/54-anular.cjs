// Anular factura / nota de crédito con el usuario indicado sobre la factura más reciente del cliente indicado.
const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll, ADMIN } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  if (process.env.PW) process.env.STEPUP_PASS = process.env.PW;
  await uiLogin(page, process.env.U ? { email: process.env.U, password: process.env.PW } : ADMIN);
  const p = panel(page);
  await go(page, 'invoices'); await page.waitForTimeout(1500);
  await p.locator('tbody tr').filter({ hasText: process.env.CLI }).first().click(); await page.waitForTimeout(2500);
  const act = process.env.ACT || 'Anular';
  const n = log.requests.length;
  await p.getByRole('button', { name: act }).first().click(); await page.waitForTimeout(1200);
  const d = page.locator('[role=dialog]').last();
  console.log('DLG', (await d.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600));
  console.log('URL', page.url().split('/e/')[1]);
  await shot(page, `anul-${act.replace(/\W/g, '')}-0`);
  if (process.env.GO) {
    if (await d.count()) { const t = d.locator('textarea, input[type=text]').first(); if (await t.count()) await t.fill('QA3 anulación por error de digitación'); await d.getByRole('button').last().click(); }
    await page.waitForTimeout(2500); await stepUpAll(page); await page.waitForTimeout(1500);
    console.log('RED', JSON.stringify(netSince(log, n)).slice(0, 1200), 'TOAST', (await toasts(page)).replace(/\s+/g, ' ').slice(-250));
    console.log('DOC', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 800));
    await shot(page, `anul-${act.replace(/\W/g, '')}-1`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
