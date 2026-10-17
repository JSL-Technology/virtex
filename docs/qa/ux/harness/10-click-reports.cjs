const { launch, login, shot } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await login(page);
  // cerrar todas las pestañas acumuladas si hay opción
  const side = (t) => page.locator('a').filter({ hasText: new RegExp('^\\s*' + t + '\\s*$') }).first();
  const rail = async (t) => { await page.locator('a, button').filter({ hasText: t }).first().click(); await page.waitForTimeout(800); };
  const steps = [['Contabilidad','Flujo de efectivo'],['Contabilidad','Balance general'],['Contabilidad','Estado de resultados'],['Ventas','Antigüedad de saldos'],['Tesorería','Tablero'],['Contabilidad','Cierre de período']];
  let n = 0;
  for (const [m, item] of steps) {
    n++; await rail(m); await side(item).click(); await page.waitForTimeout(3500);
    const h = await page.evaluate(() => ({ title: document.title, url: location.pathname, activeTab: document.querySelector('.dv-active-tab, .dv-tab.dv-active-tab')?.innerText?.trim(), heading: [...document.querySelectorAll('.dv-active-group h1, .dv-active-group h2')].map(x=>x.innerText.trim()).slice(0,2) }));
    console.log(`${m} > ${item}:`, JSON.stringify(h));
    await shot(page, `B-ruta-${n}-${item.replace(/\s+/g,'_')}`);
  }
  await browser.close();
})();
