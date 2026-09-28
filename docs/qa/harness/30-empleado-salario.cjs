const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, stepUp, click, errorsShown } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  const p = panel(page);
  await go(page, 'hcm/employees');
  await p.getByText('Pérez Ñúñez, QA-Ana').click(); await page.waitForTimeout(2500);
  console.log('STEPUP', JSON.stringify(await stepUp(page)));
  await page.waitForTimeout(1500);
  const t = await panelText(page);
  console.log('TEXTO', t.slice(t.indexOf('Vínculo laboral')).replace(/\n+/g, ' | ').slice(0, 1500));
  const inputs = await p.locator('input, select').evaluateAll((els) => els.map((e) => `${e.tagName}:${e.type}:${e.getAttribute('formcontrolname') || e.name || e.placeholder}`));
  console.log('INPUTS', JSON.stringify(inputs));
  await p.getByText('Ver los datos sensibles').click(); await page.waitForTimeout(1500);
  console.log('STEPUP2', JSON.stringify(await stepUp(page)));
  await shot(page, 'f-rh-emp-sensibles');
  await p.getByText('Registrar un cambio salarial').click(); await page.waitForTimeout(1200);
  const dlg = page.locator('[role=dialog]').last();
  const scope = (await dlg.count()) ? dlg : p;
  console.log('FORM-SAL', (await scope.innerText()).replace(/\n+/g, ' | ').slice(-600));
  const nums = scope.locator('input[type=number]'); console.log('NUMS', await nums.count());
  const dates = scope.locator('input[type=date]');
  if (await nums.count()) { await nums.last().fill('65000'); if (await dates.count()) await dates.last().fill('2026-01-15'); const n0 = log.requests.length; await scope.getByRole('button', { name: /Guardar|Registrar|Aceptar/ }).last().click(); console.log('STEPUP-S', JSON.stringify(await stepUp(page))); await page.waitForTimeout(2000); console.log('RED-S', JSON.stringify(netSince(log, n0))); console.log('HIST', (await panelText(page)).split('Historial salarial')[1]?.replace(/\n+/g, ' | ').slice(0, 300)); }
  const sal = p.locator('[formcontrolname*=alary i], [formcontrolname*=baseSalary], input[name*=alary i]');
  console.log('SALARIO-INPUTS', await sal.count());
  if (await sal.count()) { await sal.first().fill('65000'); await click(page, 'Guardar', { exact: true }); console.log('STEPUP3', JSON.stringify(await stepUp(page))); await page.waitForTimeout(2000); console.log('ERR', JSON.stringify(await errorsShown(page))); }
  console.log('RED', JSON.stringify(netSince(log).slice(-8)));
  await shot(page, 'f-rh-emp-salario');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
