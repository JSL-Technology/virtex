const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  const p = panel(page);
  for (const r of (process.env.R || 'reports/financial-statements/trial-balance,reports/financial-statements/income-statement,reports/financial-statements/balance-sheet,inventory/stock,inventory/movements,accounting/partner-ledger,reports/profitability-by-product,reports/profitability-by-customer,overview').split(',')) {
    const n = log.requests.length;
    await go(page, r); await page.waitForTimeout(2500);
    const bad = log.requests.slice(n).filter((x) => x.status === 'FAILED' || x.status >= 400).map((x) => `${x.method} ${x.url} ${x.status}`);
    console.log(`\n=== ${r} err=${JSON.stringify(bad)}\n${(await panelText(page)).replace(/\s+/g, ' ').slice(0, +(process.env.LEN || 1600))}`);
    await shot(page, `rep-${r.replace(/\//g, '_')}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
