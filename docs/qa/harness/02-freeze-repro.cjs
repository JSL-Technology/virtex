// Reproduce el congelamiento: (a) navegación por la barra lateral (SPA) vs (b) URL directa.
const { launch, uiLogin, shot, BASE } = require('./lib.cjs');
const alive = (page, ms = 8000) => Promise.race([page.evaluate(() => 'ok'), new Promise((r) => setTimeout(() => r('FROZEN'), ms))]);
const t = () => new Date().toISOString().slice(11, 19);
(async () => {
  const target = process.argv[2] || 'masters/taxes';
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page);
  console.log(t(), 'login ok', page.url(), await alive(page));
  // (a) Navegación interna del SPA
  await page.evaluate((u) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }, `/e/virtex-dev/${target}`);
  await page.waitForTimeout(4000);
  console.log(t(), 'spa nav', page.url(), await alive(page));
  await shot(page, `02-spa-${target.replace(/\//g, '_')}`);
  // (b) URL directa (recarga completa)
  const p2 = await context.newPage();
  await p2.goto(`${BASE}/e/virtex-dev/${target}`, { waitUntil: 'commit' });
  for (let i = 0; i < 4; i++) { await p2.waitForTimeout(3000); console.log(t(), 'direct', i, p2.url(), await alive(p2, 5000)); }
  await shot(p2, `02-direct-${target.replace(/\//g, '_')}`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
