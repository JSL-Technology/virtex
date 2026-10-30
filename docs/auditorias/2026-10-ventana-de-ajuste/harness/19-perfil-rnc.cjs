const { launch, uiLogin, snap, go } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page); await go(page, 'overview');
  await page.evaluate(() => { location.hash = 'settings/profile'; }); await page.locator('.sm-panel').waitFor(); await page.waitForTimeout(2000);
  const m = page.locator('.sm-panel');
  await m.getByLabel('Sitio web').fill('https://qa-7734.example.test'); await page.waitForTimeout(300);
  await snap(page, 'C-perfil-guardar-deshabilitado');
  const save = m.getByRole('button', { name: 'Guardar cambios' });
  console.log('tras editar web: habilitado=', await save.isEnabled(), 'title=', await save.getAttribute('title'), 'aria-describedby=', await save.getAttribute('aria-describedby'));
  console.log('mensajes visibles:', JSON.stringify((await m.innerText()).match(/(obligatori|requerid|RNC)[^\n]{0,80}/gi)));
  await m.getByLabel(/RNC/).fill('131246796'); await m.getByLabel(/RNC/).blur(); await page.waitForTimeout(800);
  console.log('tras llenar RNC: habilitado=', await save.isEnabled(), 'msgs=', JSON.stringify((await m.innerText()).match(/RNC[^\n]{0,80}|inválid[^\n]{0,60}/gi)));
  await snap(page, 'C-perfil-con-rnc-sin-guardar');
  await browser.close();
})();
