const { launch, instrument, shot, BASE } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  page.on('requestfailed', r => console.log('FAILED', r.url().slice(0,120), r.failure()?.errorText));
  await page.goto(BASE + (process.argv[2]||'/'), { waitUntil: 'load' }); 
  await page.waitForTimeout(+process.argv[3]||12000);
  console.log('url', page.url());
  console.log((await page.locator('body').innerText()).slice(0,800));
  await shot(page, process.argv[4]||'dbg');
  console.log(log.req.join('\n')); console.log(log.console.join('\n')); console.log(log.errors.join('\n'));
  await browser.close();
})();
