const { launch } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch({ storageState: __dirname + '/state.json' });
  const page = await context.newPage();
  page.on('request', r => { if (!/\.(js|css|svg|png|woff2?|json)(\?|$)/.test(r.url()) || r.url().includes('/api/')) console.log('REQ', r.method(), r.url().slice(0,110)); });
  page.on('response', r => { if (r.url().includes('/api/')) console.log('RES', r.status(), r.url().slice(0,110)); });
  page.on('requestfailed', r => console.log('FAIL', r.url().slice(0,110), r.failure()?.errorText));
  await page.goto('http://localhost:4200/e/virtex-dev/overview', { waitUntil: 'load' });
  await page.waitForTimeout(15000);
  const c = await context.cookies(); console.log(c.map(x => x.name + ' exp=' + new Date(x.expires*1000).toISOString()).join('\n'));
  console.log(await page.evaluate(() => document.querySelector('app-root, body > *')?.outerHTML.slice(0,300)));
  await browser.close();
})();
