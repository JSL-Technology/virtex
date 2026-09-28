// Explora el modal de Ajustes: secciones, elementos, llamadas de red por sección.
const { launch, instrument, uiLogin, shot, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  await page.locator('header').getByText('Dev User').click();
  await page.waitForTimeout(800);
  await shot(page, 'set-00-usermenu');
  const menu = await page.locator('[role=menu], .cdk-overlay-pane, [class*=dropdown]').allInnerTexts();
  console.log('USERMENU', JSON.stringify(menu));
  await page.getByText(/Configuraci[oó]n|Ajustes/).first().click();
  await page.waitForTimeout(2000);
  await shot(page, 'set-01-modal');
  const dlg = page.locator('[role=dialog]').last();
  const nav = await dlg.locator('a, button, [role=tab]').evaluateAll((els) => els.map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(Boolean));
  console.log('NAV', JSON.stringify(nav));
  const secs = nav.slice(1, 21);
  const map = [];
  for (const sname of secs) {
    log.requests.length = 0;
    await dlg.getByText(sname, { exact: true }).first().click().catch((e) => console.log('ERRCLICK', sname));
    await page.waitForTimeout(1800);
    const hash = await page.evaluate(() => location.hash);
    const bad = log.requests.filter((x) => x.status === 'FAILED' || x.status >= 400).map((x) => `${x.method} ${x.url} ${x.status} ${x.body.slice(0, 200)}`);
    const n = await dlg.locator('input, select, textarea, button, a, [role=switch], [role=tab]').count();
    map.push({ sname, hash, n, bad, api: log.requests.map((x) => `${x.method} ${x.url} ${x.status}`).filter((x) => !/workspace|jobs/.test(x)) });
    await shot(page, 'set-' + hash.replace(/[#\/]/g, '_'));
  }
  require('fs').writeFileSync(require('path').join(__dirname, 'settings-sections.json'), JSON.stringify(map, null, 1));
  for (const m of map) console.log(m.sname, m.hash, m.n, JSON.stringify(m.bad));
  console.log('NET', JSON.stringify(netSince(log)));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
