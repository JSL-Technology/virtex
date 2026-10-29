const { launch, instrument, shot, BASE } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await page.goto(BASE + '/es/mx/auth/register'); await page.waitForTimeout(3000);
  await page.getByLabel('Nombre', { exact: true }).fill('María José'); await page.getByLabel('Apellidos').fill("O'Connor-Núñez");
  await page.getByLabel('Correo electrónico').fill(process.env.EMAIL);
  await page.getByLabel('Teléfono', { exact: true }).fill(process.env.TEL || '5512345678');
  await page.getByLabel('Contraseña', { exact: true }).fill('QA-Test-Pass-2026!'); await page.getByLabel('Confirmar contraseña').fill('QA-Test-Pass-2026!');
  await page.getByRole('button', { name: 'Siguiente' }).click(); await page.waitForTimeout(3000);
  await shot(page, 'R-dbg', true);
  console.log(await page.locator('main, body').first().innerText().then(t => t.slice(0, 1500)));
  console.log(log.req.slice(-5).join('\n'));
  await browser.close();
})();
