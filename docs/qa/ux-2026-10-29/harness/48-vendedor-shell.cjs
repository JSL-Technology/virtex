const { session, shot, panel, text, resetThrottle, BASE, SLUG } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-vend.json', { email: 'qa.ux3.vendedor@example.com', password: 'QA-Vend-Pass-2026!' });
  await page.goto(BASE + '/unauthorized?url=%2Fe%2F' + SLUG + '%2Faccounting%2Fjournal-entries'); await page.waitForTimeout(2500);
  const sp = page.getByRole('button', { name: 'Solicitar permiso' }).or(page.getByRole('link', { name: 'Solicitar permiso' }));
  console.log('solicitar href', await sp.first().getAttribute('href'));
  const nk = page.getByText('¿No sabes qué permisos necesitas?'); console.log('no-sabes tag', await nk.evaluate(e => e.tagName + ' ' + (e.getAttribute('href') || '')));
  await page.getByText('Volver al panel').click(); await page.waitForTimeout(3500); console.log('volver →', page.url(), await page.title());
  await shot(page, 'T-vend-3-panel');
  const rail = await page.locator('nav.rail a, nav.rail button').allInnerTexts(); console.log('RAIL', rail.map(s => s.replace(/\s+/g, ' ')));
  for (let i = 0; i < rail.length; i++) { await page.locator('nav.rail a, nav.rail button').nth(i).click(); await page.waitForTimeout(800); console.log(' ', rail[i].replace(/\s+/g, ' '), '→', (await page.locator('nav.sidebar a').allInnerTexts()).map(s => s.trim()).join(', ')); }
  console.log('home text:', (await text(page)).slice(0, 400).replace(/\n/g, ' / '));
  console.log('403s', log.req.filter(r => / 403 /.test(r)).map(r => r.split(' ').slice(0, 2).join(' ')));
  await close();
})();
