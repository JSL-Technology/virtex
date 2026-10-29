const { launch, instrument, login, shot, BASE } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  const t0 = Date.now();
  await page.goto(BASE + '/'); await page.waitForTimeout(3000);
  console.log('landing url', page.url(), 'title', await page.title(), (Date.now()-t0)+'ms');
  await shot(page, '000-landing');
  await login(page);
  console.log('after login', page.url(), await page.title());
  await page.waitForTimeout(3000);
  await shot(page, '001-after-login');
  await context.storageState({ path: __dirname + '/state-admin.json' });
  console.log(log.req.slice(0,40).join('\n')); console.log(log.console.join('\n')); console.log(log.errors.join('\n'));
  await browser.close();
})();
