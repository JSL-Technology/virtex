const { launch, instrument, uiLogin, shot, BASE } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  console.log('after login', page.url());
  await page.waitForTimeout(3000);
  await shot(page, '00-after-login');
  console.log('BODY', (await page.locator('body').innerText()).slice(0, 1500));
  // C-02: recarga con sesión
  const t0 = Date.now();
  const ok = await Promise.race([page.reload({ waitUntil: 'load' }).then(() => 'reloaded'), new Promise((r) => setTimeout(() => r('timeout'), 30000))]);
  console.log('reload', ok, Date.now() - t0, page.url());
  await page.waitForTimeout(4000);
  const resp = await Promise.race([page.evaluate(() => document.body.innerText.slice(0, 400)), new Promise((r) => setTimeout(() => r('FROZEN'), 10000))]);
  console.log('after reload body:', resp);
  await shot(page, '00-after-reload');
  console.log(JSON.stringify(log.requests.filter(r=>r.status>=400||r.status==='FAILED'), null, 1).slice(0, 3000));
  console.log('console errors', log.console.slice(0, 15));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
