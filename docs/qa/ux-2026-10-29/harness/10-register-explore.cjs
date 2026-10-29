const { launch, instrument, shot, BASE } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await page.goto(BASE + '/es/auth/register'); await page.waitForTimeout(4000);
  console.log(page.url(), await page.title());
  await shot(page, 'R-01-registro-paso1', true);
  console.log(await page.locator('body').innerText());
  const f = await page.locator('input,select,textarea,button').evaluateAll(els => els.filter(e=>e.offsetParent).map(e => e.tagName+'/'+(e.type||'')+'|'+(e.getAttribute('formcontrolname')||e.name||'')+'|'+(e.labels&&e.labels[0]?e.labels[0].innerText:'')+'|'+(e.placeholder||'')+'|'+e.innerText.slice(0,30)));
  console.log(f.join('\n'));
  console.log(log.req.join('\n'));
  await browser.close();
})();
