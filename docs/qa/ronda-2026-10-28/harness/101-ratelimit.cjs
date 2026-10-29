const { launch, instrument, uiLogin, go, panel } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page, { email: 'qa3-contador@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page); await go(page, 'masters/currencies/exchange-rates').catch(() => {}); await go(page, 'accounting/journal-entries'); await page.waitForTimeout(2000);
  const t0 = Date.now(); let first429 = null; let n = 0;
  for (let i = 0; i < 40 && !first429; i++) {
    const rows = p.locator('tbody tr'); const c = await rows.count(); if (!c) break;
    await rows.nth(i % c).click().catch(() => {}); await page.waitForTimeout(1500); n++;
    await go(page, 'accounting/journal-entries'); await page.waitForTimeout(1500);
    const bad = log.requests.find((r) => r.status === 429); if (bad) first429 = `${bad.method} ${bad.url}`;
  }
  console.log(`aperturas=${n} en ${Math.round((Date.now() - t0) / 1000)}s; peticiones API=${log.requests.length}; primer 429=${first429}`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
