const { launch, shot } = require('./lib.cjs');
(async () => {
  for (const [loc, lang] of [['en-US','en'],['es-MX','es'],['pt-BR','pt']]) {
    const { browser, context } = await launch({ locale: loc });
    const page = await context.newPage();
    await page.goto(`http://localhost:4200/${lang}/auth/login`, { waitUntil: 'load' }); await page.waitForTimeout(2500);
    const href = await page.locator('a[href*="register"]').first().getAttribute('href');
    console.log(loc, 'register link ->', href);
    await browser.close();
  }
  const { browser, context } = await launch();
  const page = await context.newPage();
  for (const p of ['es/do','es/mx','es/co','en/us','es/ar','es/cl','es/pe','pt/br','es/es','es/gt','es/pa','es/cr','es/ec']) {
    await page.goto(`http://localhost:4200/${p}/auth/register`, { waitUntil: 'load' }); await page.waitForTimeout(2500);
    const ok = !page.url().includes('/login');
    console.log(p, '->', page.url().replace('http://localhost:4200',''), ok ? 'OK' : 'REDIRECT');
    if (['es/do','en/us','es/mx','pt/br'].includes(p)) await shot(page, `auth/R-${p.replace('/','-')}-registro`, true);
  }
  await browser.close();
})();
