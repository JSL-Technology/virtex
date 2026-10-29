const { session, ADMIN, shot, panel, errors, text, resetThrottle, BASE } = require('./flow-lib.cjs');
const tabs = (page) => page.locator('.dv-tab').allInnerTexts().then(t => t.map(s => s.trim()).join(' | '));
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-admin.json', ADMIN);
  await page.goto(BASE + '/e/virtex-dev/overview'); await page.waitForTimeout(3500);
  console.log('TABS antes', await tabs(page));
  await page.locator('aside.main-sidebar').getByText('Virtex Dev').first().click(); await page.waitForTimeout(1000);
  if (await page.getByRole('button', { name: 'Aceptar' }).count()) { await page.getByRole('button', { name: 'Aceptar' }).click(); await page.waitForTimeout(3000); }
  console.log('aceptar →', page.url(), await errors(page)); await shot(page, 'O-4-aceptada');
  const t0 = Date.now();
  await page.getByText(/QA-UX3 Comer/).first().click(); await page.waitForTimeout(4000);
  console.log('cambio →', Date.now() - t0, 'ms', page.url(), await page.title()); await shot(page, 'O-5-cambiada');
  console.log('TABS después', await tabs(page)); console.log('rail', (await page.locator('nav.rail').innerText()).replace(/\n+/g, ' '));
  await page.goBack(); await page.waitForTimeout(3000); console.log('ATRÁS →', page.url(), await page.title()); await shot(page, 'O-6-atras');
  console.log('TABS tras atrás', await tabs(page));
  await close();
})();
