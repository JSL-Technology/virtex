const { launch, uiLogin, go } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page, { email: 'qa7734.consulta@example.test', password: 'QA-7734-Consulta-2026!' }); await go(page, 'inventory/adjustments');
  for (const s of ['accounting', 'sequences', 'fiscal']) {
    await page.evaluate((s) => { location.hash = 'settings/' + s; }, s); await page.locator('.sm-panel').waitFor(); await page.waitForTimeout(2500);
    await page.screenshot({ path: `${__dirname}/../capturas/config/Y-restringido-${s}.png` });
    console.log(s, '|', (await page.locator('.sm-content').innerText()).replace(/\s+/g, ' ').slice(0, 300));
  }
  await browser.close();
})();
