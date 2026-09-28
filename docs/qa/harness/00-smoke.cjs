const { launch, instrument, uiLogin, shot, BASE } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  console.log('landing url', page.url());
  await shot(page, '00-landing');
  await uiLogin(page);
  console.log('after login', page.url());
  await page.waitForTimeout(2000);
  await shot(page, '00-after-login');
  console.log(JSON.stringify(log, null, 1).slice(0, 4000));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
