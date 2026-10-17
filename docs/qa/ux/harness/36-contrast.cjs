const fs = require('fs');
const { launch, login } = require('./flow-lib.cjs');
const AXE = fs.readFileSync(process.env.AXE_PATH || require.resolve('axe-core/axe.min.js'), 'utf8');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await login(page);
  for (const p of ['invoices', 'accounting/periods', 'reports/fiscal-returns']) {
    await page.evaluate((u) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }, '/e/virtex-dev/' + p); await page.waitForTimeout(3500);
    await page.addScriptTag({ content: AXE });
    const r = await page.evaluate(async () => { const a = await axe.run(document, { runOnly: ['color-contrast', 'nested-interactive', 'aria-required-children', 'target-size'] }); return a.violations.map(v => ({ id: v.id, n: v.nodes.length, ex: v.nodes.slice(0, 6).map(n => (n.any[0]?.message || n.failureSummary || '').slice(0, 160) + ' :: ' + (n.html || '').slice(0, 90)) })); });
    console.log('==', p); for (const v of r) { console.log(v.id, v.n); v.ex.forEach(e => console.log('   ', e.replace(/\n/g, ' '))); }
  }
  await browser.close();
})();
