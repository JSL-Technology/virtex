// Pasos 4-6 del alta (fiscal, empresa, plan) — exploración con dumps.
module.exports = async (page, step, log) => {
  const errs = async () => page.evaluate(() => [...document.querySelectorAll('[role=alert], [class*=error]')].filter(e => e.offsetParent && !e.querySelector('select,input')).map(e => e.innerText.trim()).filter(Boolean));
  await page.getByRole('button', { name: 'Siguiente' }).click(); await page.waitForTimeout(800);
  console.log('FISCAL vacío → errores:', (await errs()).filter(e => !e.includes('\n')).length); await step('12-fiscal-vacio', true);
  await page.getByLabel('RFC').fill('ABC123'); await page.getByLabel('RFC').blur(); await page.waitForTimeout(800);
  console.log('RFC inválido →', (await errs()).filter(e => !e.includes('\n')));
  await page.getByLabel('RFC').scrollIntoViewIfNeeded(); await page.screenshot({ path: require('path').resolve(__dirname, '../evidence/R-14-rfc-interpolacion.png') });
  await page.getByLabel('RFC').fill(process.env.RFC || 'DEM010203AB5'); await page.getByLabel('RFC').blur(); await page.waitForTimeout(1500);
  console.log('RFC ejemplo →', (await errs()).filter(e => !e.includes('\n')));
  await page.getByLabel('Dirección fiscal').fill('Av. Insurgentes Sur 1234, Col. Del Valle');
  await page.getByLabel('Ciudad').fill('Ciudad de México');
  await page.getByLabel('Estado').selectOption({ label: 'Ciudad de México' });
  await page.getByLabel('Código postal').fill('03100');
  await page.getByLabel(/Régimen fiscal/).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Siguiente' }).click(); await page.waitForTimeout(2500);
  console.log('tras fiscal →', (await errs()).filter(e => !e.includes('\n')));
  const d5 = await step('13-paso5-empresa', true); console.log(d5.f.filter(x=>/^(INPUT|SELECT|TEXTAREA|BUTTON)/.test(x)).join('\n'));
  if (process.env.STOP === '5') return;
  await page.getByLabel('Nombre de la empresa').fill(process.env.ORG || 'QA-UX3 Comercializadora Ñandú & Hijos S.A. de C.V.');
  await page.getByLabel('Industria').selectOption({ index: 2 }); await page.getByLabel('Tamaño de la empresa').selectOption({ index: 2 });
  await page.getByRole('button', { name: 'Siguiente' }).click(); await page.waitForTimeout(2500);
  const d6 = await step('16-paso6-plan', true); console.log(d6.f.filter(x=>/^(INPUT|BUTTON)/.test(x)).join('\n'));
  if (process.env.STOP === '6') return;
  await page.locator('.checkbox-wrapper').last().click(); console.log('checked', await page.getByLabel(/Acepto los Términos/).isChecked());
  const cta = page.getByRole('button', { name: 'Registrarse' }); const t0 = Date.now();
  await cta.click(); for (let i = 0; i < 40 && /register/.test(page.url()); i++) await page.waitForTimeout(500); console.log('registro tardó', Date.now() - t0, 'ms', page.url()); await page.waitForTimeout(8000);
  await step('17-tras-alta', false);
  for (let i = 0; i < 6 && /auth|register|payment|checkout/.test(page.url()); i++) { await page.waitForTimeout(3000); }
  await step('18-primer-ingreso', false);
  console.log(log.req.slice(-25).join('\n'));
  await page.context().storageState({ path: __dirname + '/state-mx.json' });
};
