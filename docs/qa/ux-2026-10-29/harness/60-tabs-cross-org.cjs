const { session, ADMIN, shot, panel, text, resetThrottle, BASE } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-admin.json', ADMIN);
  await page.goto(BASE + '/e/qa-ux3-comercializadora-nandu-hijos-s-a-de-c-v/overview'); await page.waitForTimeout(4000);
  console.log('TABS', (await page.locator('.dv-tab').allInnerTexts()).map(s => s.trim()));
  await page.locator('.dv-tab').filter({ hasText: 'Nueva factura' }).click(); await page.waitForTimeout(3000);
  console.log('URL', page.url()); await shot(page, 'O-7-borrador-otra-empresa');
  console.log((await text(page)).replace(/\nPAB[\s\S]*?yuan renminbi/, '').slice(0, 900));
  await page.locator('.dv-tab').filter({ hasText: 'Facturas' }).click(); await page.waitForTimeout(2500);
  console.log('FACTURAS en MX:', (await text(page)).slice(0, 500).replace(/\n+/g, ' | '));
  await close();
})();
