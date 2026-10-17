const { launch, login, shot, instrument, nav } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Ventas', 'Facturas');
  await shot(page, 'F-fac-8-lista');
  const P = page.locator('.dv-active-group .dv-content-container');
  console.log('LISTA:', (await P.innerText()).slice(0, 600));
  await P.getByText('FAC-00000001').first().click().catch(async()=> await P.locator('tbody tr').first().click()); await page.waitForTimeout(3000);
  // scroll interno al fondo
  await page.evaluate(() => { document.querySelectorAll('.dv-active-group *').forEach(e => { if (e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY.match(/auto|scroll/)) e.scrollTop = e.scrollHeight; }); });
  await page.waitForTimeout(800);
  await shot(page, 'F-fac-9-totales');
  // tooltips/aria de la barra
  const tb = await P.locator('button').evaluateAll(bs => bs.filter(b => b.offsetParent && !b.innerText.trim()).map(b => `aria="${b.getAttribute('aria-label')||''}" title="${b.title||''}" disabled=${b.disabled}`));
  console.log('ICON BUTTONS', JSON.stringify(tb, null, 0));
  for (const t of ['Logística', 'Finanzas']) { await P.getByText(t, { exact: true }).click(); await page.waitForTimeout(1500); await shot(page, `F-fac-10-tab-${t}`); console.log(t, ':', (await P.innerText()).split(t).pop().slice(0, 700)); }
  console.log(log.req.filter(r => / [45]\d\d /.test(r)).join('\n'));
  await browser.close();
})();
