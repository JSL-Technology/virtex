const { session, MX, shot, panel, text, go, resetThrottle } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-mx.json', MX);
  await go(page, process.argv[2]); await shot(page, 'dbg');
  console.log(page.url(), await page.title()); console.log((await text(page)).slice(0, 600));
  console.log('buttons', (await panel(page).getByRole('button').allInnerTexts()).map(s=>s.trim()), 'links', (await panel(page).getByRole('link').allInnerTexts()).map(s=>s.trim()).slice(0,10));
  console.log(log.req.filter(r=>/ [45]\d\d /.test(r)).join('\n'));
  await close();
})();
