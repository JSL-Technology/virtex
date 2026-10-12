const { launch, instrument, shot } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch({ storageState: __dirname + '/state.json' });
  const page = await context.newPage(); const log = instrument(page);
  await page.goto('http://localhost:4200' + process.argv[2], { waitUntil: 'load' });
  for (const s of [3,10,20]) { await page.waitForTimeout(s*1000 - (s==3?0:(s==10?3000:10000))); console.log(s+'s', page.url(), JSON.stringify((await page.locator('body').innerText()).slice(0,150))); }
  await shot(page, 'dbg-blank');
  console.log(log.req.join('\n')); console.log(log.console.join('\n')); console.log(log.errors.join('\n'));
  await browser.close();
})();
