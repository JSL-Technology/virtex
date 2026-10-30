// Captura cada sección de Configuración pliegue a pliegue, desplazando su contenedor de scroll real.
const path = require('path');
const { launch, uiLogin, go } = require('./lib.cjs');
const DIR = path.resolve(__dirname, '../capturas/config');
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page); await go(page, 'overview');
  await page.evaluate(() => { location.hash = 'settings/my-profile'; }); await page.locator('.sm-panel').waitFor();
  const modal = page.locator('.sm-panel');
  const navs = await modal.locator('.nav-link').evaluateAll((els) => els.map((e) => e.innerText.trim()));
  for (let i = 0; i < navs.length; i++) {
    for (let k = 0; k < 3 && await page.locator('.cdk-overlay-container [role=dialog]').count(); k++) { await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
    if (!(await page.locator('.sm-panel').count())) { await page.evaluate(() => { location.hash = 'settings/my-profile'; }); await page.locator('.sm-panel').waitFor(); }
    await modal.locator('.nav-link').nth(i).click(); await page.waitForTimeout(2600);
    const n = String(i + 1).padStart(2, '0');
    if (await page.locator('.cdk-overlay-container [role=dialog]').count()) await page.screenshot({ path: `${DIR}/${n}-${slug(navs[i])}-stepup.png` });
    for (let k = 0; k < 3 && await page.locator('.cdk-overlay-container [role=dialog]').count(); k++) { await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
    const steps = await page.evaluate(() => {
      const c = document.querySelector('.sm-content');
      const s = [c, ...c.querySelectorAll('*')].find((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4);
      if (!s) return 1; s.setAttribute('data-qa-scroller', '1'); s.scrollTop = 0; return Math.min(5, Math.ceil(s.scrollHeight / s.clientHeight));
    });
    for (let p = 0; p < steps; p++) {
      if (p) await page.evaluate((p) => { const s = document.querySelector('[data-qa-scroller]'); s.scrollTop = p * (s.clientHeight - 60); }, p);
      await page.waitForTimeout(350);
      await modal.screenshot({ path: `${DIR}/${n}-${slug(navs[i])}-p${p + 1}.png` });
    }
    console.log(n, navs[i], steps);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
