const { launch, shot } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await page.goto('http://localhost:4200/es/auth/login', { waitUntil: 'load' }); await page.waitForTimeout(2500);
  const btns = await page.evaluate(() => [...document.querySelectorAll('button, a')].map(b => `${b.tagName} aria="${b.getAttribute('aria-label')||''}" title="${b.title||''}" text="${b.innerText.trim().slice(0,30)}" href=${b.getAttribute('href')}`));
  console.log(btns.join('\n'));
  await page.getByText('Regístrate').click(); await page.waitForTimeout(3000);
  console.log('register url', page.url(), await page.title());
  await shot(page, 'auth/R01-registro-paso1', true);
  console.log((await page.locator('body').innerText()).slice(0, 1500));
  await browser.close();
})();
