const { launch, shot } = require('./lib.cjs');
(async () => {
  for (const [p, loc] of [['es/mx','es-MX'],['es/co','es-CO'],['es/do','es-DO'],['es/ec','es-EC']]) {
    const { browser, context } = await launch({ locale: loc });
    const page = await context.newPage();
    await page.goto(`http://localhost:4200/${p}/auth/register`, { waitUntil: 'load' }); await page.waitForTimeout(3500);
    console.log('URL directa', p, '->', page.url().replace('http://localhost:4200',''));
    if (p === 'es/co') await shot(page, 'C03-registro-colombia-url-directa');
    await browser.close();
  }
})();
