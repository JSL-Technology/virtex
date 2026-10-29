const { session, MX, shot, resetThrottle, BASE, SLUG } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, close } = await session('state-mx.json', MX);
  await page.goto(BASE + '/e/' + SLUG + '/overview'); await page.waitForTimeout(3500);
  const s = page.getByLabel('Búsqueda global'); await s.click(); await s.fill('Ñandú'); await page.waitForTimeout(2500);
  await shot(page, 'S-busqueda-null');
  await close();
})();
