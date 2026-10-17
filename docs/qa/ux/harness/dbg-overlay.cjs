const { launch } = require('./lib.cjs');
(async () => { const { browser, context } = await launch(); const page = await context.newPage();
  await page.goto('http://localhost:4200/es/auth/login', { waitUntil: 'load' }); await page.waitForTimeout(4000);
  console.log(await page.evaluate(() => document.querySelector('vite-error-overlay')?.shadowRoot?.textContent?.slice(0, 800) || 'sin overlay'));
  await browser.close(); })();
