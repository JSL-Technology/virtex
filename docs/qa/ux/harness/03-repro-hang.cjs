const { launch, login, shot } = require('./lib.cjs');
const { execSync } = require('child_process');
const pg = () => execSync(`sudo -u postgres psql -d erp -tAc "select state||' '||coalesce(wait_event,'')||' '||left(regexp_replace(query,'\\s+',' ','g'),70) from pg_stat_activity where datname='erp' and state<>'idle' and pid<>pg_backend_pid()"`).toString().trim();
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await login(page);
  await context.storageState({ path: __dirname + '/state.json' });
  for (const p of (process.argv[2]||'reports/financial-statements/balance-sheet,reports/financial-statements/income-statement').split(',')) {
    await page.goto('http://localhost:4200/e/virtex-dev/' + p, { waitUntil: 'load' }); await page.waitForTimeout(6000);
    console.log('after', p, '\n', pg() || '(sin transacciones abiertas)');
  }
  await shot(page, 'C01-tras-estados-financieros');
  const t0 = Date.now();
  const r = await page.evaluate(async () => { const c = new AbortController(); setTimeout(() => c.abort(), 15000); try { const x = await fetch('http://localhost:3000/api/v1/auth/session', { credentials: 'include', signal: c.signal }); return x.status; } catch (e) { return 'TIMEOUT ' + e.name; } });
  console.log('auth/session ->', r, Date.now() - t0, 'ms');
  await browser.close();
})();
