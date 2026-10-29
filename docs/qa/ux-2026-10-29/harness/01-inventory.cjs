const { launch, instrument, login, BASE, fs } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch({ storageState: __dirname + '/state-admin.json' });
  const page = await context.newPage(); instrument(page);
  await page.goto(BASE + '/e/virtex-dev/overview'); await page.waitForTimeout(4000);
  const mods = await page.locator('nav.rail a, nav.rail button').allInnerTexts();
  const inv = [];
  for (let i = 0; i < mods.length; i++) {
    await page.locator('nav.rail a, nav.rail button').nth(i).click(); await page.waitForTimeout(1200);
    const items = await page.evaluate(() => {
      const nav = document.querySelector('nav.sidebar'); const out = []; let group = '';
      nav.querySelectorAll('*').forEach(el => {
        if (el.children.length === 0 && /^[A-ZÁÉÍÓÚÑ ,.Y&]+$/.test(el.textContent.trim()) && el.textContent.trim().length > 2 && !el.closest('a')) group = el.textContent.trim();
        if (el.tagName === 'A') out.push({ group, label: el.innerText.trim().replace(/\s+/g,' '), href: el.getAttribute('href') });
      });
      return out;
    });
    inv.push({ module: mods[i].replace(/\s+/g,' ').trim(), items });
  }
  fs.writeFileSync(__dirname + '/inventory.json', JSON.stringify(inv, null, 1));
  let n = 0; inv.forEach(m => { console.log('##', m.module, m.items.length); m.items.forEach(it => { n++; console.log('  ', it.group, '|', it.label, '|', it.href); }); });
  console.log('TOTAL', n);
  await browser.close();
})();
