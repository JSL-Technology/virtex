const { launch, instrument, shot, ADMIN, netSince } = require('./lib.cjs');
const POS = 'http://localhost:4300';
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 200)));
  await page.goto(POS); await page.waitForTimeout(4000);
  console.log('URL', page.url(), 'BODY', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 600));
  await shot(page, 'pos-0');
  const email = page.locator('input[type=email], input[name=email], input[autocomplete=username]').first();
  if (await email.count()) {
    await email.fill(ADMIN.email); await page.locator('input[type=password]').first().fill('incorrecta-xyz'); await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(3000);
    console.log('[login-malo]', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300));
    await page.locator('input[type=password]').first().fill(ADMIN.password); await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(6000);
  }
  console.log('URL2', page.url(), 'BODY2', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 1200));
  console.log('CTRLS', JSON.stringify(await page.locator('input, select, button, a').evaluateAll((es) => es.filter((e) => e.offsetWidth).map((e) => `${e.tagName}:${(e.innerText || e.placeholder || e.getAttribute('aria-label') || '').trim().slice(0, 30)}`))));
  console.log('RED', JSON.stringify(log.requests.map((r) => `${r.method} ${r.url.replace('http://localhost:4300', '')} ${r.status}`)).slice(0, 1500));
  await shot(page, 'pos-1');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
