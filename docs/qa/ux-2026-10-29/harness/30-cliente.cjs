const { launch, instrument, shot, panel, fields, errors, text, go, resetThrottle } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { browser, context } = await launch({ storageState: __dirname + '/state-mx.json' });
  const page = await context.newPage(); const log = instrument(page);
  await go(page, 'contacts/customers'); await shot(page, 'T-cli-0-lista');
  console.log(await text(page));
  await panel(page).getByRole('button', { name: /Nuevo cliente/ }).or(panel(page).getByRole('link', { name: /Nuevo cliente/ })).first().click(); await page.waitForTimeout(2500);
  await shot(page, 'T-cli-1-form', true); console.log('URL', page.url(), await page.title());
  console.log((await text(page)).slice(0, 2500)); console.log((await fields(page)).join('\n'));
  const save = panel(page).getByRole('button', { name: /Guardar|Crear/ }).last(); console.log('save btn:', await save.innerText(), 'enabled', await save.isEnabled());
  if (await save.isEnabled()) { await save.click(); await page.waitForTimeout(1500); }
  console.log('ERR vacio', await errors(page)); await shot(page, 'T-cli-2-vacio', true);
  console.log('focus', await page.evaluate(() => document.activeElement.outerHTML.slice(0, 150)));
  console.log((await fields(page)).filter(f => /inv=true/.test(f)).join('\n'));
  await context.storageState({ path: __dirname + '/state-mx.json' });
  console.log(log.req.slice(-8).join('\n'));
  await browser.close();
})();
