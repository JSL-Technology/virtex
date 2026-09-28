// Flujo Compras: orden de compra (con producto QA) → factura de proveedor (gasto + ITBIS) → pago a proveedor.
const { launch, instrument, uiLogin, shot, go, fill, click, panel, panelText, netSince, errorsShown, stepUp } = require('./lib.cjs');
async function vxPick(page, loc, text) {
  await loc.click({ force: true });
  if (text) await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(1500);
  const opts = await page.locator('[role=option]').allInnerTexts();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  return opts;
}
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); console.log(`[${name}] url=${page.url().split('/e/')[1]} errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n))}`); await shot(page, `f-com-${name}`); };
  const only = process.env.ONLY || 'po,bill,pay';
  if (only.includes('po')) {
    await go(page, 'purchasing/orders/new');
    await step('po-1-vacio', async () => { await click(page, 'Guardar', { exact: true }); });
    await step('po-2-valido', async () => {
      console.log('PROVEEDORES', await vxPick(page, p.getByPlaceholder('Buscar o seleccionar…').first(), 'QA-Prov'));
      await fill(page, 'Fecha esperada', '2026-10-05');
      const row = p.locator('tbody tr').first();
      console.log('PRODUCTOS', await vxPick(page, row.locator('input[role=combobox]').first(), 'QA-Producto'));
      const nums = row.locator('input[type=number], input[inputmode=decimal]');
      console.log('NUM-INPUTS', await nums.count());
      await nums.nth(0).fill('10'); await nums.nth(1).fill('550'); await nums.nth(2).fill('18');
      await page.waitForTimeout(800);
      console.log('TOTALES', (await panelText(page)).split('Subtotal')[1]?.replace(/\n+/g, ' ').slice(0, 120));
      await click(page, 'Guardar', { exact: true });
      console.log('STEPUP', JSON.stringify(await stepUp(page)));
    });
    await step('po-3-detalle', async () => { console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 900)); console.log('BOTONES', JSON.stringify(await p.getByRole('button').allInnerTexts())); });
  }
  if (only.includes('bill')) {
    await go(page, 'accounts-payable/new');
    await step('bill-1-vacio', async () => { await click(page, 'Guardar factura'); });
    await step('bill-2-valido', async () => {
      console.log('PROVEEDORES', await vxPick(page, p.getByPlaceholder('Seleccionar proveedor').first(), 'QA-Prov'));
      await fill(page, 'N.º de comprobante fiscal', 'B0100000123');
      await fill(page, 'Fecha de Vencimiento', '2026-10-28');
      await p.getByPlaceholder('Descripción').first().fill('QA - Servicio de limpieza septiembre');
      const nums = p.locator('input[type=number]');
      await nums.nth(0).fill('1'); await nums.nth(1).fill('5000');
      console.log('CUENTAS', (await vxPick(page, p.getByPlaceholder('Seleccionar cuenta').first(), '')).slice(0, 15));
      await click(page, 'Mostrar').catch(() => {});
      console.log('DESGLOSE', (await panelText(page)).split('Desglose fiscal')[1]?.replace(/\n+/g, ' | ').slice(0, 700));
      await click(page, 'Guardar factura');
      console.log('STEPUP', JSON.stringify(await stepUp(page)));
    });
    await step('bill-3-detalle', async () => { console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 900)); });
  }
  if (only.includes('pay')) {
    await go(page, 'accounts-payable/payments');
    await step('pay-1-form', async () => { console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 900)); });
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
