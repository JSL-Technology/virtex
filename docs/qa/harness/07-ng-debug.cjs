const { launch, uiLogin } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  page.on('console', (m) => { if (/tab|mount|error/i.test(m.text())) console.log('CONSOLE', m.type(), m.text().slice(0, 400)); });
  await uiLogin(page);
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const el = document.querySelector('app-tab-wrapper');
    const c = window.ng && ng.getComponent(el);
    if (!c) return 'no ng';
    const tab = c.currentTab && c.currentTab();
    return { hasComp: !!c.compRef, hostLen: c.host && c.host.length, route: tab && tab.route, mounted: c.mountedSig, params: c.params, apiId: c.api && c.api.id, loading: c.loading(), tab: tab && { id: tab.id, type: tab.type, path: tab.path, component: String(tab.component).slice(0, 80) }, tabs: c.tabState.tabs ? c.tabState.tabs().map((t) => t.id) : Object.keys(c.tabState) };
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
