// Prueba realista: login, trabajar normal, 3 recargas F5 separadas 10 s; sondear la API cada 5 s durante 60 s.
const { launch, login, shot } = require('./lib.cjs');
const { execSync } = require('child_process');
const locks = () => execSync(`sudo -u postgres psql -d erp -tAc "select count(*) filter (where wait_event_type='Lock')||' bloqueadas / '||count(*) filter (where state like 'idle in%')||' idle-in-tx' from pg_stat_activity where datname='erp'"`).toString().trim();
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await login(page);
  const probe = async () => { const t = Date.now(); const r = await page.evaluate(async () => { const c = new AbortController(); setTimeout(() => c.abort(), 8000); try { return (await fetch('http://localhost:3000/api/v1/me/workspace', { credentials: 'include', signal: c.signal })).status; } catch (e) { return 'SIN RESPUESTA (8 s)'; } }); return `${r} en ${Date.now()-t} ms`; };
  console.log('t=0 tras login', await probe(), '|', locks());
  await page.getByText('Ventas', { exact: true }).first().click(); await page.waitForTimeout(1500);
  await page.getByRole('link', { name: 'Facturas' }).first().click(); await page.waitForTimeout(10000);
  console.log('tras abrir Facturas', await probe(), '|', locks());
  for (let k = 1; k <= 3; k++) { await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(10000); console.log(`tras F5 #${k}`, await probe(), '|', locks()); }
  for (let k = 1; k <= 6; k++) { await page.waitForTimeout(5000); console.log(`+${k*5}s`, await probe(), '|', locks()); }
  await shot(page, 'C01-tras-3-recargas');
  await browser.close();
})();
