// RR.HH.: departamento (vacío, válido, duplicado) y empleado (vacío, inválidos, cédula del placeholder, válido con salario).
const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1800); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-250)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 900)}`); await shot(page, `rh-${name}`); };
  await go(page, 'hcm/departments');
  await step('dep-1-abrir', async () => { await p.getByRole('button', { name: 'Nuevo departamento' }).click(); await page.waitForTimeout(1200); const d = page.locator('[role=dialog]').last(); console.log('   DLG?', await page.locator('[role=dialog]').count(), (await (await page.locator('[role=dialog]').count() ? d : p).innerText()).replace(/\s+/g, ' ').slice(0, 500)); });
  const scope = async () => (await page.locator('[role=dialog]').count()) ? page.locator('[role=dialog]').last() : p;
  await step('dep-2-vacio', async () => { const s = await scope(); await s.getByRole('button', { name: /Guardar|Crear/ }).last().click(); });
  await step('dep-3-valido', async () => { const s = await scope(); const inputs = s.locator('input[type=text], input:not([type])'); console.log('   inputs', await inputs.count()); await inputs.first().fill('QA3-1180-Operaciones'); if (await inputs.count() > 1) await inputs.nth(1).fill('QA3OPS'); await s.getByRole('button', { name: /Guardar|Crear/ }).last().click(); await page.waitForTimeout(1500); console.log('   LISTA', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 300)); });
  await step('dep-4-duplicado', async () => { await p.getByRole('button', { name: 'Nuevo departamento' }).click(); await page.waitForTimeout(1000); const s = await scope(); const inputs = s.locator('input[type=text], input:not([type])'); await inputs.first().fill('QA3-1180-Operaciones'); if (await inputs.count() > 1) await inputs.nth(1).fill('QA3OPS'); await s.getByRole('button', { name: /Guardar|Crear/ }).last().click(); });
  await page.keyboard.press('Escape');
  await go(page, 'hcm/employees/new');
  await step('emp-1-vacio', async () => { await p.getByRole('button', { name: 'Guardar' }).click(); });
  await step('emp-2-invalidos', async () => { await p.locator('[formcontrolname=firstName]').fill('QA3'); await p.locator('[formcontrolname=lastName]').fill('Inválido'); await p.locator('[formcontrolname=email]').fill('x@'); await p.locator('[formcontrolname=identityDocument]').fill('001-1234567-8'); await p.getByRole('button', { name: 'Guardar' }).click(); });
  await step('emp-3-valido', async () => {
    await p.locator('[formcontrolname=firstName]').fill('María QA3'); await p.locator('[formcontrolname=lastName]').fill('Peña-7731'); await p.locator('[formcontrolname=email]').fill('qa3-7731@example.com');
    await p.locator('[formcontrolname=jobTitle]').fill('Analista QA3');
    console.log('   DEPTOS', JSON.stringify(await p.locator('[formcontrolname=departmentId] option').allInnerTexts()));
    await p.locator('[formcontrolname=departmentId]').selectOption({ index: 1 }).catch(() => {});
    await p.locator('input[type=date]').first().fill('2026-01-05');
    await p.locator('[formcontrolname=identityDocument]').fill('001-3377331-7');
    await p.getByLabel(/Salario base/).fill('65000').catch(async () => p.locator('input[type=number]').last().fill('65000'));
    await p.locator('[formcontrolname=bankName]').fill('Banco QA3'); await p.locator('[formcontrolname=bankAccountNumber]').fill('7731000001');
    await p.getByRole('button', { name: 'Guardar' }).click(); await page.waitForTimeout(2500);
    console.log('   DOC', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 900));
  });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
