// Verifica A-04/C-05: tope de pestañas al restaurar, montaje perezoso y peticiones duplicadas.
const { launch, login } = require('./lib.cjs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'evidence', 'fix');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const reqs = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) reqs.push(r.url().replace(/^.*\/api\/(v1\/)?/, '')); });
  await login(page);
  await page.waitForTimeout(4000);
  const count = () => page.evaluate(() => document.querySelectorAll('.dv-tab').length);
  console.log('pestañas tras el inicio de sesión:', await count());
  console.log('branches/mine en el arranque:', reqs.filter((u) => u.includes('branches/mine')).length);
  // Abrir 16 pantallas distintas para provocar el tope.
  const routes = ['customers','products','invoices','quotes','customer-receipts','accounts-payable','suppliers','inventory/stock','accounting/journal-entries','accounting/chart-of-accounts','reports/financial-statements/balance-sheet','reports/financial-statements/income-statement','reports/financial-statements/cash-flow','reports/aging/receivables','accounting/treasury','sales/pos'];
  for (const r of routes) {
    await page.evaluate((r) => { const a = document.createElement('a'); a.href = location.pathname.split('/').slice(0,3).join('/') + '/' + r; document.body.appendChild(a); }, r);
    await page.goto(page.url().split('/').slice(0,5).join('/') + '/' + r, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  console.log('pestañas tras abrir 16 pantallas (recarga incluida):', await count());
  await page.reload(); await page.waitForTimeout(5000);
  reqs.length = 0;
  console.log('pestañas tras recargar:', await count());
  await page.goto(page.url().split('/').slice(0,5).join('/') + '/invoices/new'); await page.waitForTimeout(5000);
  const ajenas = [...new Set(reqs.filter((u) => !/invoices|customers|products|branches|taxes|currencies|auth|ncf|fiscal|organizations|settings|notifications|workspace|price-lists|payment|tabs|users|ui|i18n|periods|warehouses|uom|accounts|sequences|presence|health|feature|countries|me\b/.test(u)))];
  console.log('peticiones de otras pantallas al abrir Nueva factura:', ajenas.length, ajenas.slice(0, 10));
  console.log('branches/mine al abrir Nueva factura:', reqs.filter((u) => u.includes('branches/mine')).length);
  const widths = await page.evaluate(() => [...document.querySelectorAll('.dv-tab')].map((t) => `${Math.round(t.getBoundingClientRect().width)}:${t.innerText.trim().slice(0, 24)}`));
  console.log('anchos:', widths.join(' | '));
  await page.screenshot({ path: path.join(OUT, 'A04-pestanas.png') });
  await browser.close();
})();
