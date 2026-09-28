// Verifica en la UI de cada módulo lo que la BD muestra tras la factura FAC-00000001.
const { launch, instrument, uiLogin, shot, go, panelText, netSince } = require('./lib.cjs');
const PAGES = (process.env.PAGES || 'invoices,accounting/journal-entries,accounting/daily-journal,accounting/general-ledger,reports/financial-statements/trial-balance,reports/financial-statements/income-statement,reports/financial-statements/balance-sheet,reports/aging/receivables,inventory/products,dashboard,overview,sales/history,reports/profitability-by-product,reports/profitability-by-customer,customer-receipts').split(',');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  for (const p of PAGES) {
    const n = log.requests.length;
    await go(page, p); await page.waitForTimeout(2500);
    const t = (await panelText(page)).replace(/\n+/g, ' | ');
    const hits = ['2,360', '2360', '2.360', '2,000', '1,200', '360', '48', 'FAC-00000001', 'QA-Cliente'].filter((k) => t.includes(k));
    console.log(`## ${p}\n  contiene: ${JSON.stringify(hits)}\n  red: ${JSON.stringify(netSince(log, n))}\n  texto: ${t.slice(0, 700)}`);
    await shot(page, `x-${process.env.TAG || 'post-factura'}-${p.replace(/\//g, '_')}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
