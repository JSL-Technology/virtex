// Activa la invitación del Vendedor y recorre lo que ve (rol operativo restringido).
const { launch, instrument, shot, panel, errors, text, resetThrottle, BASE, SLUG, fs, path } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const dir = path.resolve(__dirname, '../../../../tmp/mail-outbox'); const f = fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort().reverse().map(x => JSON.parse(fs.readFileSync(path.join(dir, x)))).find(m => m.to[0].address === 'qa.ux3.vendedor@example.com');
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  await page.goto(f.context.url); await page.waitForTimeout(3500); await shot(page, 'T-vend-1-set-password', true);
  console.log((await page.locator('body').innerText()).replace(/\n{2,}/g, '\n').slice(0, 700));
  const pw = page.locator('input[type=password]'); console.log('pw inputs', await pw.count());
  for (let i = 0; i < await pw.count(); i++) await pw.nth(i).fill('QA-Vend-Pass-2026!');
  await page.getByRole('button', { name: /Guardar|Activar|Crear|Continuar|Establecer/ }).last().click(); await page.waitForTimeout(5000);
  console.log('tras activar', page.url(), await page.title()); await shot(page, 'T-vend-2-primer-ingreso');
  if (page.url().includes('/auth/login')) { await page.locator('input[type=email]').fill('qa.ux3.vendedor@example.com'); await page.locator('input[type=password]').fill('QA-Vend-Pass-2026!'); await page.locator('button[type=submit]').click(); await page.waitForTimeout(5000); console.log('login →', page.url()); }
  await context.storageState({ path: __dirname + '/state-vend.json' });
  const rail = await page.locator('nav.rail a, nav.rail button').allInnerTexts(); console.log('RAIL vendedor', rail.map(s => s.replace(/\s+/g, ' ')));
  for (const p of ['invoices', 'contacts/customers', 'accounting/journal-entries', 'accounts-payable', 'payroll/runs', 'reports/financial-statements/balance-sheet']) {
    await page.goto(BASE + '/e/' + SLUG + '/' + p); await page.waitForTimeout(3000);
    console.log(p, '→', page.url().replace(BASE, ''), '|', await page.title(), '|', (await text(page)).slice(0, 160).replace(/\n/g, ' / '), '| api', log.req.filter(r => / 40[13] /.test(r)).slice(-2).join(';')); log.req.length = 0;
    await shot(page, 'T-vend-' + p.replace(/\//g, '_'));
  }
  await browser.close();
})();
