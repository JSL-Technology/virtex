// Flujo Inventario/Ventas: producto y cliente (vacío, inválido, límite, largo, especiales, válido, doble clic, duplicado).
const { launch, instrument, uiLogin, shot, go, fill, click, panel, panelText, netSince, toasts, errorsShown } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.dismiss(); });
  await uiLogin(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); console.log(`[${name}] url=${page.url().split('/e/')[1]} toasts="${await toasts(page)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n))}`); await shot(page, `f-${name}`); };

  await go(page, 'inventory/products/new');
  await step('prod-1-vacio', async () => { await click(page, 'Guardar producto'); });
  await step('prod-2-negativos', async () => { await fill(page, 'Nombre del producto', 'QA3-Neg'); await fill(page, 'Precio de venta', '-100'); await fill(page, 'Costo unitario', '-5'); await fill(page, 'Existencia inicial', '-3'); await click(page, 'Guardar producto'); });
  await step('prod-3-largo', async () => { await fill(page, 'Nombre del producto', 'QA3-Ñ<script>alert(1)</script>&"\'' + 'x'.repeat(300)); await fill(page, 'Precio de venta', '99999999999999'); await fill(page, 'Costo unitario', '0.0001'); await fill(page, 'Existencia inicial', '1.5'); await click(page, 'Guardar producto'); });
  await go(page, 'inventory/products/new');
  await step('prod-4-valido-dobleclic', async () => {
    await fill(page, 'Nombre del producto', 'QA3-7734-Widget ergonómico');
    await fill(page, 'SKU', 'QA3-SKU-7734');
    await fill(page, 'Descripción', 'Producto de prueba QA3 — ñ, acentos y "comillas"');
    await fill(page, 'Marca', 'QA3Marca');
    await fill(page, 'Código de barras', '7501234567734');
    await fill(page, 'Precio de venta', '1250');
    await fill(page, 'Costo unitario', '700');
    await fill(page, 'Existencia inicial', '40');
    await fill(page, 'Punto de pedido', '5');
    await panel(page).getByRole('button', { name: 'Guardar producto' }).dblclick();
  });
  await go(page, 'inventory/products/new');
  await step('prod-5-servicio', async () => { await fill(page, 'Nombre del producto', 'QA3-5521-Servicio instalación'); await fill(page, 'SKU', 'QA3-SRV-5521'); await fill(page, 'Tipo', 'Servicio'); await fill(page, 'Precio de venta', '3000'); await click(page, 'Guardar producto'); });
  await go(page, 'inventory/products/new');
  await step('prod-6-sku-dup', async () => { await fill(page, 'Nombre del producto', 'QA3-Dup'); await fill(page, 'SKU', 'QA3-SKU-7734'); await fill(page, 'Precio de venta', '10'); await click(page, 'Guardar producto'); });
  await go(page, 'inventory/products');
  await step('prod-7-lista', async () => { console.log((await panelText(page)).slice(0, 900)); });

  // ---- Cliente
  await go(page, 'contacts/customers/new');
  await step('cli-1-vacio', async () => { await click(page, 'Guardar cliente'); });
  await step('cli-2-invalidos', async () => { await fill(page, 'Nombre del cliente', 'QA3-Inv'); await fill(page, 'Correo electrónico', 'no-es-correo'); await fill(page, 'Teléfono', 'abc'); await fill(page, 'Tipo de documento', 'RNC'); await fill(page, 'Número de documento', '123'); await fill(page, 'Días de crédito', '-5'); await click(page, 'Guardar cliente'); });
  await go(page, 'contacts/customers/new');
  await step('cli-3-minimo', async () => { await fill(page, 'Nombre del cliente', 'QA3-4419-Cliente mínimo'); await click(page, 'Guardar cliente'); });
  await go(page, 'contacts/customers/new');
  await step('cli-4-completo', async () => {
    await fill(page, 'Nombre del cliente', 'QA3-8812-Comercial Ñandú SRL');
    await fill(page, 'Persona de contacto', 'Ana QA3');
    await fill(page, 'Tipo de documento', 'RNC');
    await fill(page, 'Número de documento', '131246796');
    await fill(page, 'Tipo de contribuyente', 'Persona jurídica');
    await fill(page, 'Correo electrónico', 'qa3-8812@example.com');
    await fill(page, 'Teléfono', '809-555-8812');
    await fill(page, 'Línea de dirección', 'Calle QA3 #12');
    await fill(page, 'Ciudad', 'Santo Domingo');
    await fill(page, 'Estado/provincia', 'Distrito Nacional');
    await fill(page, 'Términos de pago', 'Neto 30');
    await fill(page, 'Días de crédito', '30');
    await panel(page).getByRole('button', { name: 'Guardar cliente' }).dblclick();
  });
  await go(page, 'contacts/customers/new');
  await step('cli-5-xss-largo', async () => { await fill(page, 'Nombre del cliente', 'QA3-<img src=x onerror=alert(1)>' + 'L'.repeat(260)); await click(page, 'Guardar cliente'); });
  await go(page, 'contacts/customers');
  await step('cli-6-lista', async () => { console.log((await panelText(page)).slice(0, 900)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
