// Abre el modal de Ajustes, enumera secciones y vuelca el contenido de cada una.
const { launch, instrument, uiLogin, shot } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  await page.evaluate(() => { location.hash = 'settings/profile'; });
  await page.waitForTimeout(2500);
  const dlg = page.locator('[role=dialog]').last();
  console.log('DIALOGS', await page.locator('[role=dialog]').count());
  const nav = await dlg.locator('a, button').evaluateAll((els) => els.map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')).filter(Boolean));
  console.log('NAV', JSON.stringify(nav));
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] a[href]')].map((a) => a.getAttribute('href')));
  console.log('HREFS', JSON.stringify(hrefs));
  await shot(page, 'set-00-profile');
  const sections = (process.env.SECTIONS || '').split(',').filter(Boolean);
  for (const s of sections) {
    const n = log.requests.length;
    await page.evaluate((h) => { location.hash = 'settings/' + h; }, s);
    await page.waitForTimeout(2500);
    const t = await page.locator('[role=dialog]').last().innerText().catch(() => '(sin diálogo)');
    const bad = log.requests.slice(n).filter((r) => r.status === 'FAILED' || r.status >= 400).map((r) => `${r.method} ${r.url} ${r.status} ${r.body.slice(0, 120)}`);
    console.log(`\n=== ${s} apiErr=${JSON.stringify(bad)}\n${t.replace(/\n+/g, ' | ').slice(0, 900)}`);
    await shot(page, `set-${s.replace(/\//g, '_')}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
