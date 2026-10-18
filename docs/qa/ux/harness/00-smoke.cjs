const { launch, instrument, login, shot, BASE } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await page.goto(BASE, { waitUntil: 'networkidle' }); console.log('landing', page.url());
  await shot(page, '000-landing', true);
  await login(page); console.log('after', page.url());
  await shot(page, '001-after-login');
  await context.storageState({ path: __dirname + '/state.json' });
  console.log(log.req.join('\n')); console.log(log.console.join('\n')); console.log(log.errors.join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
