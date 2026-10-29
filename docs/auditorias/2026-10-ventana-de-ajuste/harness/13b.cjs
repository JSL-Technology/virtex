const { launch, uiLogin, go } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page); await go(page, 'accounting/audit-adjustments');
  const r = await page.evaluate(async () => {
    const tok = (document.cookie.match(/(?:^|; )(?:__Host-)?XSRF-TOKEN=([^;]+)/) || [])[1];
    const res = await fetch('http://localhost:3000/api/v1/accounting/year-end-close', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(tok), 'Idempotency-Key': 'qa-7734-close-2019' }, body: JSON.stringify({ fiscalYearId: '15c9e3af-072b-4f2d-b5a4-76222937d4c7' }) });
    return [res.status, (await res.text()).slice(0, 400)];
  });
  console.log(r);
  await browser.close();
})();
