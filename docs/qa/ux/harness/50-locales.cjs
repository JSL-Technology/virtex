const { launch, shot } = require('./lib.cjs');
(async () => {
  for (const loc of ['es', 'es-419', 'es-ES', 'en-GB', 'en', 'pt-PT', 'fr-FR']) {
    const { browser, context } = await launch({ locale: loc });
    const page = await context.newPage();
    await page.goto('http://localhost:4200/', { waitUntil: 'load' }); await page.waitForTimeout(2500);
    const href = await page.locator('a[href*="register"]').first().getAttribute('href').catch(() => 'n/a');
    await page.locator('a[href*="register"]').first().click().catch(() => {}); await page.waitForTimeout(3000);
    console.log(loc.padEnd(7), 'landing', '| enlace Regístrate =', href, '| tras clic =', page.url().replace('http://localhost:4200', ''));
    if (loc === 'es-ES') await shot(page, 'C03-registro-es-ES-vuelve-al-login');
    await browser.close();
  }
})();
