// Ajustes → Comprobantes fiscales: vuelca la sección y prueba el registro de rangos.
const { launch, instrument, uiLogin, shot, netSince, toasts } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  await page.evaluate(() => { location.hash = 'settings/fiscal'; });
  await page.waitForTimeout(2500);
  const dlg = page.locator('[role=dialog]').last();
  const body = dlg.locator('main, [class*=content]').last();
  console.log((await dlg.innerText()).split('Extensiones').slice(1).join('Extensiones').replace(/\n+/g, ' | ').slice(0, 3000));
  const ctrls = await dlg.evaluate((d) => [...d.querySelectorAll('input, select, button, textarea')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => `${e.tagName}:${e.type}:${e.getAttribute('formcontrolname') || e.name || ''}:${(e.innerText || e.placeholder || e.getAttribute('aria-label') || '').trim().slice(0, 40)}${e.tagName === 'SELECT' ? ' {' + [...e.options].map((o) => o.text).join('|').slice(0, 300) + '}' : ''}`));
  console.log(ctrls.filter((c) => !/^BUTTON:button::(Mi perfil|Mis empresas)/.test(c)).slice(28).join('\n'));
  await shot(page, 'fis-00');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
