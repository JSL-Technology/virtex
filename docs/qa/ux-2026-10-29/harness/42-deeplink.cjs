const { launch, instrument, shot, panel, text, go, resetThrottle, BASE, SLUG } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { browser, context } = await launch({ storageState: __dirname + '/state-mx.json' });
  const page = await context.newPage(); const log = instrument(page);
  for (const p of ['accounts-payable/new', 'contacts/customers/new', 'invoices/new', 'accounting/journal-entries/new']) {
    await go(page, p); await page.waitForTimeout(1500);
    console.log(p, '→', page.url().replace(BASE, ''), '|', await page.title(), '|', (await text(page)).slice(0, 120).replace(/\n/g, ' / '));
    await shot(page, 'D-deeplink-' + p.replace(/\//g, '_'));
  }
  await browser.close();
})();
