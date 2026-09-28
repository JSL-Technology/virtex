// Aísla la causa del congelamiento: recarga en una sola pestaña vs. dos pestañas simultáneas.
const { launch, uiLogin, BASE } = require('./lib.cjs');
const alive = (page, ms = 6000) => Promise.race([page.evaluate(() => 'ok'), new Promise((r) => setTimeout(() => r('FROZEN'), ms))]);
(async () => {
  const mode = process.argv[2];
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page);
  if (mode === 'reload-overview') { await page.reload({ waitUntil: 'commit' }); }
  if (mode === 'goto-same-tab') { await page.goto(`${BASE}/e/virtex-dev/masters/taxes`, { waitUntil: 'commit' }); }
  if (mode === 'second-tab-overview') { const p2 = await context.newPage(); await p2.goto(`${BASE}/e/virtex-dev/overview`, { waitUntil: 'commit' }); await p2.waitForTimeout(6000); console.log('tab2', await alive(p2)); }
  await page.waitForTimeout(6000);
  console.log(mode, page.url().replace(BASE, ''), await alive(page));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
