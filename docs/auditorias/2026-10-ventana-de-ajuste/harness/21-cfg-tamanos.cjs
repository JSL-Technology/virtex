const { launch, uiLogin, snap, go } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page); await go(page, 'overview');
  await page.evaluate(() => { location.hash = 'settings/inventory-policies'; }); await page.locator('.sm-panel').waitFor(); await page.waitForTimeout(2000);
  for (const [w, h, nm] of [[1366, 768, '1366'], [768, 1024, 'tableta'], [375, 812, 'movil']]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(900); await snap(page, `C-cfg-${nm}`);
    const r = await page.evaluate(() => { const b = [...document.querySelectorAll('.sm-panel button')].find((x) => /Guardar cambios/.test(x.innerText)); const bb = b?.getBoundingClientRect(); const nav = document.querySelector('.sm-sidebar')?.getBoundingClientRect(); const c = document.querySelector('.sm-content')?.getBoundingClientRect(); return { hscroll: document.documentElement.scrollWidth > innerWidth, guardar: bb && [Math.round(bb.x), Math.round(bb.y), Math.round(bb.width)], nav: nav && [Math.round(nav.width), Math.round(nav.height)], contenido: c && [Math.round(c.width), Math.round(c.height)] }; });
    console.log(nm, JSON.stringify(r));
  }
  await browser.close();
})();
