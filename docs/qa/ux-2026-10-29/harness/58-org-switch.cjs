const { session, ADMIN, shot, panel, errors, text, resetThrottle, BASE } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-admin.json', ADMIN);
  await page.goto(BASE + '/e/virtex-dev/overview'); await page.waitForTimeout(3500);
  await shot(page, 'O-1-invitacion-pendiente');
  const inv = await page.evaluate(() => [...document.querySelectorAll('[class*=invit], [role=status], [role=alert], .banner')].filter(e => e.offsetParent).map(e => e.innerText.replace(/\s+/g, ' ').slice(0, 200)));
  console.log('banners', inv);
  await page.getByRole('button', { name: /Notificaciones/i }).or(page.locator('header button[aria-label*=otific]')).first().click().catch(e => console.log('no bell', e.message.slice(0, 60))); await page.waitForTimeout(1200);
  await shot(page, 'O-2-notificaciones'); console.log('NOTIF:', (await page.locator('[role=dialog], [role=menu], .notifications-panel, [class*=notification]').last().innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 500));
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.locator('aside.main-sidebar').getByText('Virtex Dev').first().click(); await page.waitForTimeout(1200);
  await shot(page, 'O-3-selector-empresa'); console.log('SELECTOR:', (await page.locator('[role=menu], [role=listbox], [role=dialog]').last().innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 600));
  await close();
})();
