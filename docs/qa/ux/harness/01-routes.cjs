const { launch, shot } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch({ storageState: __dirname + '/state.json' });
  const page = await context.newPage();
  await page.goto('http://localhost:4200/e/virtex-dev/overview', { waitUntil: 'load' }); await page.waitForTimeout(5000);
  console.log('url', page.url());
  const rail = page.locator('nav').first();
  const railItems = await page.evaluate(() => [...document.querySelectorAll('a, button')].filter(e => e.getBoundingClientRect().x < 80 && e.getBoundingClientRect().y > 60).map(e => (e.innerText||e.getAttribute('aria-label')||'').trim()));
  console.log('rail', railItems);
  const all = new Set();
  for (const label of railItems) {
    if (!label) continue;
    const el = page.locator('a, button').filter({ hasText: label }).first();
    try { await el.click({ timeout: 3000 }); } catch(e) { console.log('noclick', label); continue; }
    await page.waitForTimeout(800);
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].filter(e=>{const r=e.getBoundingClientRect(); return r.x>=80 && r.x<330 && r.width>0;}).map(e => e.getAttribute('href')+' | '+e.innerText.trim().replace(/\s+/g,' ')));
    console.log('==', label); links.forEach(l => { console.log('  ', l); all.add(label+' || '+l); });
  }
  require('fs').writeFileSync(__dirname+'/routes.txt', [...all].join('\n'));
  await browser.close();
})();
