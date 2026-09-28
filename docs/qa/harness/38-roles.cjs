// Pruebas por rol: menú visible, acceso a rutas permitidas/prohibidas (UI) y respuesta del backend
// a llamadas directas (fetch desde la sesión del usuario) a endpoints fuera de su rol.
const { launch, instrument, uiLogin, shot, go, panel, panelText, BASE } = require('./lib.cjs');
const USERS = {
  SELLER: { email: 'qa-vendedor@example.com', allow: ['invoices', 'invoices/new', 'contacts/customers', 'inventory/products'], deny: ['accounting/journal-entries', 'payroll/runs', 'hcm/employees', 'accounts-payable', 'accounting/treasury', 'reports/financial-statements/balance-sheet', 'masters/taxes'] },
  ACCOUNTANT: { email: 'qa-contador@example.com', allow: ['accounting/journal-entries', 'accounting/chart-of-accounts', 'reports/financial-statements/trial-balance', 'invoices'], deny: ['payroll/runs', 'hcm/employees', 'accounting/treasury', 'contacts/customers/new', 'purchasing/orders'] },
  MEMBER: { email: 'qa-miembro@example.com', allow: ['invoices', 'inventory/products'], deny: ['invoices/new', 'contacts/customers', 'accounting/journal-entries', 'payroll/runs', 'inventory/products/new'] },
};
const API_PROBES = [
  ['GET', '/journal-entries?page=1&pageSize=5'], ['GET', '/payroll/runs'], ['GET', '/hcm/employees?pageSize=5'], ['GET', '/treasury/bank-accounts'],
  ['GET', '/users?page=1&pageSize=5'], ['GET', '/accounts-payable'], ['POST', '/chart-of-accounts'], ['POST', '/customers'], ['POST', '/inventory'], ['GET', '/customers'], ['GET', '/invoices?limit=5'],
];
(async () => {
  const role = process.argv[2];
  const u = USERS[role];
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page, { email: u.email, password: 'QA-Valid-Pass-2026!' }).catch((e) => console.log('LOGIN-EXC', e.message.split('\n')[0]));
  console.log(`== ${role} aterriza en ${page.url().replace(BASE, '')}`);
  await shot(page, `role-${role}-landing`);
  const rail = await page.locator('nav, aside').first().innerText().catch(() => '');
  console.log('RIEL', rail.replace(/\n+/g, ' | ').slice(0, 300));
  const check = async (r, expect) => {
    const n = log.requests.length;
    await go(page, r); await page.waitForTimeout(1500);
    const t = (await panelText(page)).replace(/\n+/g, ' ').slice(0, 140);
    const denied = /Acceso Denegado|No tienes los permisos|unauthorized/i.test(t + page.url());
    const api403 = log.requests.slice(n).filter((x) => x.status === 403).map((x) => `${x.method} ${x.url}`);
    const ok = expect === 'allow' ? !denied && !api403.length : denied;
    console.log(`  ${ok ? 'OK ' : 'FALLA'} [${expect}] ${r} -> denegado=${denied} 403s=${JSON.stringify(api403).slice(0, 200)} | ${t.slice(0, 100)}`);
    if (!ok) await shot(page, `role-${role}-${r.replace(/\//g, '_')}`);
  };
  for (const r of u.allow) await check(r, 'allow');
  for (const r of u.deny) await check(r, 'deny');
  // Backend: llamadas directas con la sesión del usuario
  const res = await page.evaluate(async (probes) => {
    const csrf = (document.cookie.match(/(?:^|; )(?:XSRF-TOKEN|csrf[^=]*)=([^;]+)/i) || [])[1];
    const out = [];
    for (const [m, p] of probes) {
      const r = await fetch(`http://localhost:3000/api/v1${p}`, { method: m, credentials: 'include', headers: { 'content-type': 'application/json', 'x-virtex-organization': 'virtex-dev', ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf), 'x-xsrf-token': decodeURIComponent(csrf) } : {}) }, body: m === 'POST' ? '{}' : undefined });
      out.push(`${m} ${p} -> ${r.status}`);
    }
    return out;
  }, API_PROBES);
  console.log('API', JSON.stringify(res, null, 0));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
