const { launch, uiLogin } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page);
  await page.evaluate(() => { location.hash = 'settings/users'; }); await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Invitar Usuario/ }).click(); await page.waitForTimeout(1200);
  const h = page.getByText('Invitar nuevo usuario');
  const box = h.locator('xpath=ancestor::*[.//button[contains(., "Enviar invitación")]][1]');
  console.log(await box.evaluate((e) => [...e.querySelectorAll('input,select,textarea,button,[role=combobox]')].map((x) => `${x.tagName}:${x.type || ''}:${x.getAttribute('formcontrolname') || x.getAttribute('aria-label') || x.placeholder || x.innerText}`).join('\n')));
  await browser.close();
})();
