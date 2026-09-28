// Maestros de Inventario/Administración/Tesorería: categorías, almacenes, bancos, sucursales, impuestos (alta y baja QA),
// listas de precios, requisiciones. Cada uno: vacío, inválido y válido.
const { launch, instrument, uiLogin, shot, go, fill, click, panel, panelText, netSince, errorsShown, stepUpAll, toasts } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); const su = await stepUpAll(page); if (su) await page.waitForTimeout(1500); console.log(`[${name}] stepups=${su} err=${JSON.stringify(await errorsShown(page)).slice(0, 250)}\n   red=${netSince(log, n).map((x) => x.slice(0, 160)).join(' ; ')}\n   texto=${(await panelText(page)).replace(/\n+/g, ' | ').slice(0, 350)}`); await shot(page, `f-mae-${name}`); };
  const inputsOf = async () => { const dlg = page.locator('[role=dialog]').last(); return (await dlg.count()) ? dlg : p; };
  // Categorías
  await go(page, 'inventory/categories');
  await step('cat-form', async () => { await click(page, 'Nueva Categoría'); const s = await inputsOf(); console.log('CAT-FORM', (await s.innerText()).replace(/\n+/g, ' | ').slice(0, 300)); });
  await step('cat-vacio', async () => { const s = await inputsOf(); await s.getByRole('button', { name: /Guardar|Crear/ }).last().click(); });
  await step('cat-valido', async () => { const s = await inputsOf(); await s.locator('input').first().fill('QA-Categoría Muebles & Oficina'); await s.getByRole('button', { name: /Guardar|Crear/ }).last().click(); });
  await step('cat-duplicado', async () => { await click(page, 'Nueva Categoría').catch(() => {}); const s = await inputsOf(); await s.locator('input').first().fill('QA-Categoría Muebles & Oficina'); await s.getByRole('button', { name: /Guardar|Crear/ }).last().click(); });
  // Almacenes
  await go(page, 'masters/warehouses');
  await step('alm-form', async () => { await click(page, 'Nuevo almacén'); const s = await inputsOf(); console.log('ALM-FORM', (await s.innerText()).replace(/\n+/g, ' | ').slice(0, 300)); });
  await step('alm-vacio', async () => { const s = await inputsOf(); await s.getByRole('button', { name: /Guardar|Crear/ }).last().click(); });
  await step('alm-valido', async () => { const s = await inputsOf(); const ins = s.locator('input[type=text], input:not([type])'); const k = await ins.count(); for (let i = 0; i < k; i++) await ins.nth(i).fill(i === 0 ? 'QA-Almacén Central' : `QA-${i}`); await s.getByRole('button', { name: /Guardar|Crear/ }).last().click(); });
  // Bancos (debería listar el banco de la cuenta QA)
  await go(page, 'masters/banks');
  await step('bancos', async () => {});
  await step('banco-nuevo', async () => { await click(page, 'Nuevo banco'); });
  // Sucursales
  await go(page, 'masters/branches');
  await step('sucursal-nueva', async () => { await click(page, 'Nueva sucursal'); });
  // Impuestos
  await go(page, 'masters/taxes/new');
  await step('imp-vacio', async () => { await click(page, 'Guardar Impuesto'); });
  await step('imp-negativo', async () => { await fill(page, 'Nombre del Impuesto', 'QA-Impuesto Neg'); await p.locator('[formcontrolname=rate], input[name=rate]').first().fill('-5'); await click(page, 'Guardar Impuesto'); });
  await step('imp-150', async () => { await p.locator('[formcontrolname=rate], input[name=rate]').first().fill('150'); await click(page, 'Guardar Impuesto'); });
  await step('imp-valido', async () => { await fill(page, 'Nombre del Impuesto', 'QA-Impuesto Selectivo 10%'); await p.locator('[formcontrolname=rate], input[name=rate]').first().fill('10'); await click(page, 'Guardar Impuesto'); });
  await go(page, 'masters/taxes');
  await step('imp-lista', async () => {});
  await step('imp-eliminar-QA', async () => { const row = p.locator('tr').filter({ hasText: 'QA-Impuesto' }).first(); await row.getByRole('button').last().click(); await page.waitForTimeout(800); await shot(page, 'f-mae-imp-confirm'); await page.getByRole('button', { name: /^(Eliminar|Aceptar|Confirmar)$/ }).last().click({ timeout: 3000 }).catch(() => {}); });
  // Lista de precios
  await go(page, 'masters/price-lists/new');
  await step('pl-vacio', async () => { await click(page, 'Guardar lista'); });
  await step('pl-valido', async () => {
    await p.locator('[formcontrolname=name]').fill('QA-Lista Mayoristas');
    const sels = p.locator('select'); console.log('PL-SELECTS', JSON.stringify(await sels.evaluateAll((ss) => ss.map((s) => [...s.options].map((o) => o.text.trim())))));
    await sels.nth(1).selectOption({ label: 'DOP - Peso Dominicano' }).catch(() => {});
    const prod = p.locator('input[role=combobox]').first(); await prod.click({ force: true }); await page.keyboard.type('QA-Producto'); await page.waitForTimeout(1200); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await p.locator('[formcontrolname=price]').first().fill('900');
    await click(page, 'Guardar lista');
  });
  // Requisición
  await go(page, 'purchasing/requisitions/new');
  await step('req-vacio', async () => { await click(page, 'Guardar', { exact: true }); });
  await step('req-valido', async () => {
    await p.locator('[formcontrolname=requiredDate]').fill('2026-10-15');
    await p.locator('[formcontrolname=notes]').fill('QA - reposición de sillas para nueva oficina');
    const prod = p.locator('input[role=combobox]').first(); await prod.click({ force: true }); await page.keyboard.type('QA-Producto'); await page.waitForTimeout(1200); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await p.locator('[formcontrolname=quantity]').first().fill('5'); await p.locator('[formcontrolname=estimatedUnitPrice]').first().fill('600');
    await click(page, 'Guardar', { exact: true });
  });
  await step('req-acciones', async () => { console.log('BOTONES', JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean))); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
