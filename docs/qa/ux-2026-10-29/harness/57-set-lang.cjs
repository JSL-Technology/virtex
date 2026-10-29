// Uso: node 57-set-lang.cjs English|Español|Português
const { session, ADMIN, shot, resetThrottle, BASE } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-admin.json', ADMIN);
  await page.goto(BASE + '/e/virtex-dev/overview'); await page.waitForTimeout(3000);
  await page.locator('header button[aria-haspopup], header .user-menu, header').getByText(/Dev User/).first().click(); await page.waitForTimeout(800);
  console.log('roles', await page.evaluate(() => [...document.querySelectorAll('*')].filter(e => ['English','Español','Português'].includes(e.innerText?.trim()) && e.children.length===0).map(e => e.tagName + ':' + (e.getAttribute('role')||'') + ':' + (e.closest('[role]')?.getAttribute('role')||'')))); await page.getByText(process.argv[2], { exact: true }).last().click(); await page.waitForTimeout(3000);
  console.log('lang', await page.evaluate(() => document.documentElement.lang), page.url(), await page.title());
  await shot(page, 'L-set-' + process.argv[2]);
  console.log(log.req.filter(r => /lang|locale|profile|me /.test(r)).join('\n'));
  await close();
})();
