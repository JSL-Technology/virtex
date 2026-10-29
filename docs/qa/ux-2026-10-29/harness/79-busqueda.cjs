const { session, MX, shot, resetThrottle, BASE, SLUG } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, close } = await session('state-mx.json', MX);
  await page.goto(BASE + '/e/' + SLUG + '/overview'); await page.waitForTimeout(3500);
  for (const q of ['Ñandú', 'nandu', 'QA-Vol 050', 'FAC-00000001', 'cafe']) {
    const s = page.getByLabel('Búsqueda global'); await s.click(); await s.fill(q); await page.waitForTimeout(2000);
    const res = await page.evaluate(() => [...document.querySelectorAll('[role=option], [role=listbox] a, [class*=search-result], [class*=result-item]')].filter(e => e.offsetParent).map(e => e.innerText.replace(/\s+/g, ' ').slice(0, 70)));
    console.log(`"${q}" →`, res.length, res.slice(0, 4));
    if (q === 'nandu') await shot(page, 'S-busqueda-sin-tilde');
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Crear nuevo' }).click(); await page.waitForTimeout(800);
  console.log('CREAR NUEVO:', (await page.locator('[role=menu]').last().innerText().catch(() => '')).replace(/\n+/g, ' | ')); await shot(page, 'S-crear-nuevo');
  await close();
})();
