const { launch, login, shot } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await login(page);
  const info = () => page.evaluate(() => ({ url: location.pathname.replace('/e/virtex-dev/',''), tab: document.querySelector('.dv-active-tab')?.innerText?.trim(), h: [...document.querySelectorAll('.dv-active-group h1, .dv-active-group h2')].map(x=>x.innerText.trim()).slice(0,1), tabs: document.querySelectorAll('.dv-tab').length }));
  console.log('inicio', JSON.stringify(await info()));
  // Cerrar pestaña activa repetidamente hasta que no sea Flujo
  for (let k=0;k<3;k++) { const i = await info(); if (!/Flujo/.test(i.tab||'')) break; await page.locator('.dv-active-tab .dv-default-tab-action, .dv-active-tab [aria-label*="errar"], .dv-active-tab button').first().click().catch(e=>console.log('noclose', e.message.slice(0,60))); await page.waitForTimeout(1500); console.log('tras cerrar', JSON.stringify(await info())); }
  await page.locator('a, button').filter({ hasText: 'Contabilidad' }).first().click(); await page.waitForTimeout(800);
  for (const item of ['Balance general', 'Estado de resultados', 'Libro: mayor', 'Balance general']) {
    await page.locator('a').filter({ hasText: new RegExp('^\\s*' + item + '\\s*$') }).first().click(); await page.waitForTimeout(3500);
    console.log('click', item, '=>', JSON.stringify(await info()));
  }
  await shot(page, 'B-ruta-limpio-balance');
  await browser.close();
})();
