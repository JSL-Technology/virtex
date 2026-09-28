// Inspecciona el DOM del área de trabajo tras abrir una página desde la barra lateral.
const { launch, instrument, uiLogin, shot } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  await page.waitForTimeout(3000);
  log.requests.length = 0;
  await page.getByText('Ventas', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole('link', { name: /Facturas/ }).first().click().catch((e) => console.log('click err', e.message));
  await page.waitForTimeout(5000);
  await shot(page, '05-invoices-sidebar');
  const info = await page.evaluate(() => {
    const dv = document.querySelector('[class*=dv-], dockview, .dockview-theme-abyss, [class*=dockview]');
    const panels = [...document.querySelectorAll('.dv-content-container, [class*=content-container]')].map((e) => ({ cls: e.className, w: e.clientWidth, h: e.clientHeight, html: e.innerHTML.slice(0, 300) }));
    return { url: location.href, dvCls: dv && dv.className, panels, mainHtml: (document.querySelector('app-main-layout, main') || document.body).innerHTML.length };
  });
  console.log(JSON.stringify(info, null, 1).slice(0, 3000));
  console.log('API', log.requests.map((r) => `${r.method} ${r.url} ${r.status}`));
  console.log('CONSOLE', log.console, log.pageErrors);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
