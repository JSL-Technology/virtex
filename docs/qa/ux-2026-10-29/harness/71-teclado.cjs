const { session, ADMIN, shot, panel, resetThrottle, BASE } = require('./flow-lib.cjs');
const desc = () => { const e = document.activeElement; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); const lab = (e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute('aria-label') || e.placeholder || e.innerText || e.tagName; return { t: (e.tagName + ':' + lab).replace(/\s+/g, ' ').slice(0, 45), ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? 'outline ' + s.outlineWidth : (s.boxShadow !== 'none' ? 'shadow' : 'NINGUNO'), y: Math.round(r.top) }; };
(async () => {
  resetThrottle();
  const { page, close } = await session('state-admin.json', ADMIN);
  await page.goto(BASE + '/e/virtex-dev/invoices/new'); await page.waitForTimeout(3500);
  await page.locator('body').click({ position: { x: 700, y: 140 } });
  const seq = [];
  for (let i = 0; i < 1; i++) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(desc)); }
  seq.forEach((s, i) => console.log(i + 1, s.t, '|', s.ring, '| y', s.y));
  console.log('sin foco visible:', seq.filter(s => s.ring === 'NINGUNO').length, '/', seq.length);
  // Escape en Ajustes y devolución de foco
  await page.goto(BASE + '/e/virtex-dev/overview'); await page.waitForTimeout(3000);
  await page.locator('header').getByText('Dev User').click(); await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Configuración' }).click(); await page.waitForTimeout(2000);
  console.log('foco al abrir ajustes:', JSON.stringify(await page.evaluate(desc)));
  for (let i = 0; i < 60; i++) await page.keyboard.press('Tab');
  console.log('foco tras 60 Tab (¿atrapado en modal?):', await page.evaluate(() => !!document.activeElement.closest('[role=dialog]')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  console.log('modal cerrado con Escape:', !(await page.locator('[role=dialog]').isVisible().catch(() => false)), '| foco devuelto a:', JSON.stringify(await page.evaluate(desc)));
  // Atajos / skip link
  await page.keyboard.press('Tab'); console.log('primer Tab de la página:', JSON.stringify(await page.evaluate(desc)));
  await close();
})();
