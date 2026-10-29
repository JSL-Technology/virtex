const { launch, instrument, uiLogin, snap, go, panelText, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  console.log('url', page.url());
  await go(page, 'inventory/adjustments');
  await page.waitForTimeout(2500);
  console.log('url2', page.url());
  await snap(page, '01-lista-ajustes-vacia');
  console.log((await panelText(page)).slice(0, 1500));
  console.log(netSince(log).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
