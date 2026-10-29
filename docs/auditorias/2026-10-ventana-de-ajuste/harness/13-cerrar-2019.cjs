const fs = require('fs');
const { launch, uiLogin, go, api } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page); await go(page, 'accounting/audit-adjustments');
  const lines = fs.readFileSync('/tmp/claude-0/-home-user-virtex/16a56624-fcd2-58a5-a86d-b5fc046524c4/scratchpad/p2019.txt', 'utf8').trim().split('\n');
  for (const l of lines) { const [id, name] = l.split('|'); const r = await api(page, 'POST', '/accounting/close-period', { periodId: id }); console.log(name, r.status, r.body?.messageKey || r.body?.code); }
  for (const scope of ['close_fiscal_year', 'year_end_close', 'close_year']) { const s = await api(page, 'POST', '/auth/step-up', { scope, password: 'QA-Ajuste-2026!' }); console.log('stepup', scope, s.status); }
  const y = await api(page, 'POST', '/accounting/year-end-close', { fiscalYearId: '15c9e3af-072b-4f2d-b5a4-76222937d4c7' });
  console.log('year close', y.status, JSON.stringify(y.body).slice(0, 400));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
