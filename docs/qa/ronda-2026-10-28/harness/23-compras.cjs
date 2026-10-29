// Compras: proveedor (vacío, inválido, mínimo, completo), OC (impuesto %, estados), botones del documento.
const { launch, instrument, uiLogin, shot, go, fill, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-220)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 1200)}`); await shot(page, `com-${name}`); };
  const combo = async (idx, q) => { const cb = p.locator('input[type=text]').nth(idx); await cb.click(); await cb.fill(q); await page.waitForTimeout(1500); const o = page.locator('[role=option]'); console.log('OPC', JSON.stringify(await o.allInnerTexts())); await o.filter({ hasText: q }).first().click(); await page.waitForTimeout(1000); };
  if (!process.env.SKIP_SUP) {
    await go(page, 'contacts/suppliers/new');
    await step('sup-1-vacio', async () => { await p.getByRole('button', { name: 'Guardar proveedor' }).click(); });
    await step('sup-2-invalido', async () => { await fill(page, 'Nombre del proveedor', 'QA3-Inv'); await fill(page, 'Correo electrónico', 'x@'); await fill(page, 'Teléfono', 'abc'); await fill(page, 'Tipo de documento', 'RNC'); await fill(page, 'Número de documento', '12'); await p.getByRole('button', { name: 'Guardar proveedor' }).click(); });
    await step('sup-3-minimo', async () => { await fill(page, 'Correo electrónico', ''); await fill(page, 'Teléfono', ''); await fill(page, 'Número de documento', ''); await fill(page, 'Nombre del proveedor', 'QA3-3307-Suministros mínimos'); await p.getByRole('button', { name: 'Guardar proveedor' }).click(); });
    await go(page, 'contacts/suppliers/new');
    await step('sup-4-completo', async () => { await fill(page, 'Nombre del proveedor', 'QA3-9045-Distribuidora Caribe SRL'); await fill(page, 'Persona de contacto', 'Luis QA3'); await fill(page, 'Tipo de documento', 'RNC'); await fill(page, 'Número de documento', '101010632'); await fill(page, 'Dirección', 'Av. QA3 #45'); await fill(page, 'Correo electrónico', 'qa3-9045@example.com'); await fill(page, 'Teléfono', '809-555-9045'); await fill(page, 'Tipo de contribuyente', 'Persona jurídica'); await p.getByRole('button', { name: 'Guardar proveedor' }).click(); });
    await go(page, 'contacts/suppliers'); console.log('LISTA-PROV', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 500));
  }
  await go(page, 'purchasing/orders/new');
  await step('po-1-vacio', async () => { await p.getByRole('button', { name: 'Guardar' }).click(); });
  await step('po-2-linea', async () => {
    await combo(0, 'QA3-9045');
    await combo(1, 'QA3-7734');
    const row = p.locator('tbody tr').first();
    await row.locator('input[formcontrolname=quantity]').fill('10');
    await row.locator('input[formcontrolname=unitPrice]').fill('650');
    console.log('TAX-DEFAULT', await row.locator('input[formcontrolname=taxRate]').inputValue());
    await row.locator('input[formcontrolname=taxRate]').fill('18');
    await page.waitForTimeout(1000);
    console.log('FORM', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 900));
  });
  await step('po-3-guardar', async () => { await p.getByRole('button', { name: 'Guardar' }).click(); await page.waitForTimeout(2000); console.log('DOC', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 900)); console.log('BOTONES', JSON.stringify(await p.getByRole('button').allInnerTexts())); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
