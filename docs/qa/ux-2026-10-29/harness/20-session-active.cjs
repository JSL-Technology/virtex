// ¿Expira la sesión de un usuario ACTIVO? Login sin «Mantener la sesión», navegación cada 40 s durante 22 min.
const { launch, instrument, login, shot, BASE } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page); const t0 = Date.now(); const routes = ['invoices', 'contacts/customers', 'inventory/products', 'accounting/journal-entries'];
  let i = 0;
  while (Date.now() - t0 < 22 * 60000) {
    await page.waitForTimeout(40000); i++;
    const mode = i % 3 === 0 ? 'reload' : 'spa';
    if (mode === 'reload') { await page.reload(); } else { await page.evaluate((r) => { const a = [...document.querySelectorAll('nav.sidebar a, a')].find(x => x.getAttribute('href') && x.getAttribute('href').endsWith('/' + r)); if (a) a.click(); else history.pushState({}, '', location.pathname); }, routes[i % routes.length]); }
    await page.waitForTimeout(3000);
    const min = ((Date.now() - t0) / 60000).toFixed(1);
    const auth = log.req.filter(r => /auth\/(refresh|session)/.test(r) || / 401 /.test(r)).slice(-3);
    console.log(min, 'min', mode, page.url().replace(BASE, ''), await page.title(), auth.join(' ; ')); log.req.length = 0;
    if (page.url().includes('/auth/')) { await shot(page, 'S-sesion-expirada-' + min); console.log('EXPIRADA a los', min, 'min'); break; }
  }
  await browser.close();
})();
