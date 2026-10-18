const { launch } = require('./lib.cjs');
const { execSync } = require('child_process');
const pg = () => execSync(`sudo -u postgres psql -d erp -tAc "select pid||' '||state||' '||now()-xact_start from pg_stat_activity where datname='erp' and state like 'idle in%'"`).toString().trim();
(async () => {
  const { browser, context } = await launch({ storageState: __dirname + '/state.json' });
  const page = await context.newPage();
  const pending = new Map();
  page.on('request', r => { if (r.url().includes('/api/')) pending.set(r, Date.now()); });
  page.on('requestfinished', r => pending.delete(r)); page.on('requestfailed', r => pending.delete(r));
  await page.goto('http://localhost:4200/e/virtex-dev/' + process.argv[2], { waitUntil: 'load' }); await page.waitForTimeout(8000);
  console.log('pending:', [...pending.entries()].map(([r,t]) => r.method()+' '+r.url().replace(/.*v1/,'')+' '+(Date.now()-t)+'ms'));
  console.log('pg:', pg());
  await browser.close();
})();
