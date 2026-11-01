// Por rol: login, riel/menú visible, sondas de páginas y de API (lo que el rol no debería poder hacer).
const { launch, instrument, uiLogin, shot, go, panel, panelText, BASE } = require('./lib.cjs');
const PW = 'QA3-Pass-Segura-2026!';
const USERS = (process.env.USERS || 'qa3-vendedor,qa3-contador,qa3-miembro,qa3-admin2').split(',');
const PAGES = ['invoices/new', 'contacts/customers/new', 'accounting/journal-entries/new', 'payroll/runs', 'hcm/employees', 'accounting/treasury', 'purchasing/orders/new', 'inventory/products/new', 'reports/financial-statements/balance-sheet', 'accounts-payable'];
(async () => {
  const { browser } = await launch();
  for (const u of USERS) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await context.newPage(); const log = instrument(page);
    await uiLogin(page, { email: `${u}@example.com`, password: PW }).catch((e) => console.log('login', e.message.split('\n')[0]));
    console.log(`\n##### ${u} -> ${page.url().replace(BASE, '')}`);
    const rail = await page.locator('nav, aside').first().innerText().catch(() => '');
    console.log('RIEL', rail.replace(/\s+/g, ' ').slice(0, 200));
    await shot(page, `rol-${u}-inicio`);
    for (const pg of PAGES) {
      const n = log.requests.length;
      await go(page, pg); await page.waitForTimeout(1200);
      let t = (await panelText(page)).replace(/\s+/g, ' '); if (!t.trim()) { t = '[sin panel] ' + (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ').slice(0, 300); await shot(page, `rol-${u}-${pg.replace(/\//g, '_')}`); }
      const f = log.requests.slice(n).filter((x) => x.status >= 400).map((x) => `${x.method} ${x.url.split('?')[0]} ${x.status}`);
      console.log(`  ${pg.padEnd(44)} ${/Acceso denegado/.test(t) ? 'DENEGADO' : 'abre: ' + t.slice(0, 160)} ${f.length ? 'API!: ' + f.slice(0, 3).join(', ') : ''}`);
    }
    // Sondas directas a la API con la sesión del rol
    const probes = await page.evaluate(async () => {
      const csrf = document.cookie.split('; ').find((c) => /csrf/i.test(c))?.split('=')[1];
      const r = {};
      const call = async (m, u, b) => { try { const res = await fetch('http://localhost:3000/api/v1' + u, { method: m, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf), 'X-XSRF-TOKEN': decodeURIComponent(csrf) } : {}) }, body: b ? JSON.stringify(b) : undefined }); return res.status; } catch (e) { return 'ERR'; } };
      r['GET journal-entries'] = await call('GET', '/journal-entries?page=1&pageSize=5');
      r['GET payroll/runs'] = await call('GET', '/payroll/runs');
      r['GET hcm/employees'] = await call('GET', '/hcm/employees');
      r['GET treasury/bank-accounts'] = await call('GET', '/treasury/bank-accounts');
      r['GET users'] = await call('GET', '/users?page=1&pageSize=5');
      r['GET invoices'] = await call('GET', '/invoices?limit=5');
      r['GET customers'] = await call('GET', '/customers?limit=5');
      r['POST customers'] = await call('POST', '/customers', { companyName: 'QA3-probe' });
      r['POST journal-entries'] = await call('POST', '/journal-entries', {});
      r['GET currencies'] = await call('GET', '/currencies');
      return r;
    });
    console.log('  API', JSON.stringify(probes));
    await context.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
