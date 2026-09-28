// RR.HH./Nómina: departamento, empleado (vacío, cédula inválida, correo inválido, válido), concepto, nómina.
const { launch, instrument, uiLogin, shot, go, fill, click, panel, panelText, netSince, errorsShown, stepUp, toasts, field } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1800); console.log(`[${name}] url=${page.url().split('/e/')[1]} errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n))}\n   texto=${(await panelText(page)).replace(/\n+/g, ' | ').slice(0, 500)}`); await shot(page, `f-rh-${name}`); };
  if (!process.env.SKIP_SETUP) {
    if (!process.env.SKIP_DEP) { await go(page, 'hcm/departments');
    await step('dep-vacio', async () => { await click(page, 'Nuevo departamento'); await click(page, 'Guardar', { exact: true }); });
    await step('dep-valido', async () => { const i = p.locator('input').first(); await i.fill('QA-Departamento Finanzas'); await click(page, 'Guardar', { exact: true }); console.log('STEPUP', JSON.stringify(await stepUp(page))); });
    }
    await go(page, 'hcm/employees/new');
    await step('emp-vacio', async () => { await click(page, 'Guardar', { exact: true }); });
    await step('emp-invalido', async () => {
      await fill(page, 'Nombres', 'QA-Ana'); await fill(page, 'Apellidos', 'Pérez Ñúñez'); await fill(page, 'Correo', 'ana@');
      await p.getByPlaceholder('001-1234567-8').fill('123'); await fill(page, 'Fecha de ingreso', '2030-01-01');
      await click(page, 'Guardar', { exact: true });
    });
    await step('emp-valido', async () => {
      await fill(page, 'Correo', 'qa-ana.perez@example.com');
      await p.getByPlaceholder('001-1234567-8').fill(process.env.CED || '001-0000001-7');
      await fill(page, 'Fecha de ingreso', '2026-01-15');
      await fill(page, 'Puesto', 'QA Analista contable');
      const dep = await field(page, 'Departamento'); const opts = await dep.evaluate((s) => [...s.options].map((o) => o.text)); console.log('DEPTOS', JSON.stringify(opts)); if (opts.length > 1) await dep.selectOption({ index: opts.length - 1 });
      await click(page, 'Guardar', { exact: true });
      console.log('STEPUP', JSON.stringify(await stepUp(page)));
    });
    await go(page, 'hcm/employees');
    await step('emp-lista', async () => {});
    await go(page, 'payroll/concepts');
    await step('concepto', async () => {
      await click(page, 'Nuevo concepto');
      await fill(page, 'Código', 'QA-BONO'); await fill(page, 'Nombre', 'QA Bono productividad');
      await fill(page, 'Tipo', 'Ingreso'); await fill(page, 'Cálculo', 'Porcentaje'); await fill(page, 'Tasa', '0.05');
      await click(page, 'Guardar', { exact: true }); console.log('STEPUP', JSON.stringify(await stepUp(page)));
    });
  }
  await go(page, 'payroll/runs');
  await step('nomina-crear', async () => { await click(page, 'Nueva nómina'); await click(page, 'Crear', { exact: true }); console.log('STEPUP', JSON.stringify(await stepUp(page))); });
  if (false) await step('nomina-abrir', async () => { await p.locator('tbody tr').first().click(); await page.waitForTimeout(2500); console.log('BOTONES', JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean))); });
  console.log('STEPUP-VER', JSON.stringify(await stepUp(page)));
  await page.waitForTimeout(2500);
  console.log('NOMINA', (await panelText(page)).replace(/\n+/g, ' | ').slice(0, 900));
  console.log('BOTONES', JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean)));
  for (const b of ['Calcular', 'Aprobar', 'Contabilizar', 'Pagar']) {
    const btn = p.getByRole('button', { name: new RegExp(`^\\s*${b}`, 'i') });
    if (await btn.count()) await step(`nomina-${b}`, async () => { await btn.first().click(); await page.getByRole('button', { name: /^(Aceptar|Confirmar)$/ }).click({ timeout: 2500 }).catch(() => {}); console.log('STEPUP', JSON.stringify(await stepUp(page))); console.log('TOAST', (await toasts(page)).slice(-200)); console.log('BOTONES', JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean))); });
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
