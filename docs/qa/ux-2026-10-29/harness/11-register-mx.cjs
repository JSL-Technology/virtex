const { launch, instrument, shot, BASE } = require('./lib.cjs'); const { dump } = require('./reglib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await page.goto(BASE + '/es/auth/register'); await page.waitForTimeout(3000);
  // orden de foco frente al visual
  const order = [];
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => (document.activeElement.innerText || document.activeElement.getAttribute('formcontrolname') || document.activeElement.tagName).trim().slice(0,25))); }
  console.log('TAB ORDER', order.join(' > '));
  await page.getByRole('button', { name: 'México' }).click(); await page.waitForTimeout(2500);
  console.log('URL', page.url(), await page.title());
  await shot(page, 'R-02-mx-paso1', true);
  const d = await dump(page); console.log(d.main); console.log(d.f.join('\n'));
  console.log(log.req.join('\n'));
  await browser.close();
})();
