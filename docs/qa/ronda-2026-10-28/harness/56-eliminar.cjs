// Eliminaciones con dependencias (solo datos QA3): cliente con facturas, producto con documentos, departamento con empleado, proveedor con OC; y uno sin dependencias.
const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  page.on('dialog', (d) => { console.log('  NATIVE-DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const del = async (name, route, rowText) => {
    await go(page, route); await page.waitForTimeout(1500);
    const row = p.locator('tbody tr').filter({ hasText: rowText }).first();
    if (!(await row.count())) { console.log(`[${name}] fila no encontrada`); return; }
    const n = log.requests.length;
    const b = row.getByRole('button', { name: /Eliminar|Borrar|Retirar|Archivar/ }).or(row.locator('button[aria-label*=liminar], button[title*=liminar]')).first();
    if (!(await b.count())) { const btns = await row.locator('button').evaluateAll((bs) => bs.map((x) => x.getAttribute('aria-label') || x.title || x.innerText)); console.log(`[${name}] sin botón eliminar; botones fila=${JSON.stringify(btns)}`); return; }
    await b.click(); await page.waitForTimeout(1000);
    const d = page.locator('[role=dialog], [role=alertdialog]').last();
    const dt = (await d.innerText().catch(() => '')).replace(/\s+/g, ' ');
    console.log(`[${name}] confirm="${dt.slice(0, 300)}"`);
    await shot(page, `del-${name}-0`);
    if (await d.count()) await d.getByRole('button').filter({ hasText: /Eliminar|Confirmar|Sí|Aceptar|Retirar|Archivar|Desactivar/ }).last().click().catch(() => console.log("   (sin botón de confirmar)"));
    await page.waitForTimeout(2000); await stepUpAll(page);
    console.log(`   red=${JSON.stringify(netSince(log, n)).slice(0, 600)} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-220)}"`);
    await shot(page, `del-${name}-1`);
  };
  if(0) await del('cliente-con-facturas', 'contacts/customers', 'QA3-8812');
  await del('producto-con-docs', 'inventory/products', 'QA3-7734');
  await del('departamento-con-empleado', 'hcm/departments', 'QA3-1180');
  await del('proveedor-con-oc', 'contacts/suppliers', 'qa3-9045');
  await del('proveedor-sin-docs', 'contacts/suppliers', 'Acciones');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
