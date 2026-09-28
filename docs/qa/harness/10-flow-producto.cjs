// Flujo Inventario: alta de producto (vacío, inválido, límites, largo, especiales, válido, doble clic).
const { launch, instrument, uiLogin, shot, go, fill, click, panelText, netSince, toasts, errorsShown } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.dismiss(); });
  await uiLogin(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1200); console.log(`[${name}] url=${page.url().split('/e/')[1]} toasts="${await toasts(page)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n))}`); await shot(page, `f-prod-${name}`); };

  await go(page, 'inventory/products/new');
  await step('1-vacio', async () => { await click(page, 'Guardar producto'); });
  await step('2-negativos', async () => { await fill(page, 'Nombre del Producto', 'QA-Prod-Neg'); await fill(page, 'Precio de Venta', '-100'); await fill(page, 'Costo Unitario', '-5'); await fill(page, 'Cantidad en Stock', '-3'); await click(page, 'Guardar producto'); });
  await step('3-largo-especiales', async () => { await fill(page, 'Nombre del Producto', 'QA-' + 'Ñ<script>alert(1)</script>&"\''.repeat(1) + 'x'.repeat(300)); await fill(page, 'Precio de Venta', '99999999999999'); await fill(page, 'Costo Unitario', '0.0001'); await fill(page, 'Cantidad en Stock', '1.5'); await click(page, 'Guardar producto'); });
  // Volver a un formulario limpio
  await go(page, 'inventory/products/new');
  await step('4-valido-dobleclic', async () => {
    await fill(page, 'Nombre del Producto', 'QA-Producto-01 Silla ergonómica');
    await fill(page, 'SKU', 'QA-SKU-001');
    await fill(page, 'Descripción', 'Producto de prueba QA — ñ, acentos y "comillas"');
    await fill(page, 'Precio de Venta', '1000');
    await fill(page, 'Costo Unitario', '600');
    await fill(page, 'Cantidad en Stock', '50');
    await fill(page, 'Nivel de Reorden', '5');
    const btn = page.locator('.dv-groupview.dv-active-group').getByRole('button', { name: 'Guardar producto' });
    await btn.dblclick();
  });
  await go(page, 'inventory/products');
  await step('5-lista', async () => { console.log((await panelText(page)).slice(0, 800)); });
  // SKU duplicado
  await go(page, 'inventory/products/new');
  await step('6-sku-duplicado', async () => { await fill(page, 'Nombre del Producto', 'QA-Producto-Dup'); await fill(page, 'SKU', 'QA-SKU-001'); await fill(page, 'Precio de Venta', '10'); await click(page, 'Guardar producto'); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
