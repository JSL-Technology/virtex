const { session, shot, panel, text, resetThrottle, BASE, SLUG } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-vend.json', { email: 'qa.ux3.vendedor@example.com', password: 'QA-Vend-Pass-2026!' });
  await page.goto(BASE + '/e/' + SLUG + '/overview'); await page.waitForTimeout(4000);
  await panel(page).getByText('Indicadores del negocio').scrollIntoViewIfNeeded(); await page.waitForTimeout(800);
  await shot(page, 'T-vend-4-kpis-403');
  console.log((await text(page)).split('Indicadores del negocio')[1]?.slice(0, 600));
  await panel(page).getByText('Reportes', { exact: true }).scrollIntoViewIfNeeded(); await panel(page).getByText('Reportes', { exact: true }).click(); await page.waitForTimeout(3000);
  console.log('Reportes →', page.url(), await page.title()); await shot(page, 'T-vend-5-reportes');
  await close();
})();
