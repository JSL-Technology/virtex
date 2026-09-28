const { launch, uiLogin, go, panel } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page);
  await go(page, 'invoices/new');
  const html = await panel(page).locator('tbody tr').first().evaluate((e) => e.outerHTML.replace(/_ngcontent-[^=]+=""/g, '').replace(/\s+/g, ' '));
  console.log(html.slice(0, 2500));
  await browser.close();
})();
