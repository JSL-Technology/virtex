const { launch, instrument, uiLogin, shot, go, panel, netSince, toasts, errorsShown } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page); await go(page, 'masters/taxes/new');
  await p.locator('[formcontrolname=name]').fill('QA3-Imp-150'); await p.locator('[formcontrolname=rate]').fill('150');
  let n = log.requests.length; await p.getByRole('button', { name: /Guardar/ }).click(); await page.waitForTimeout(2000);
  console.log('[150]', JSON.stringify(await errorsShown(page)), JSON.stringify(netSince(log, n)).slice(0, 300), (await toasts(page)).replace(/\s+/g, ' ').slice(-150));
  await shot(page, 'prev-imp150');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
