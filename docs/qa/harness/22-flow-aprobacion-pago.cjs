// OC con ITBIS 0.18 → guardar; factura proveedor: enviar a aprobación → bandeja Aprobaciones → aprobar → pagar.
const { launch, instrument, uiLogin, shot, go, fill, click, panel, panelText, netSince, errorsShown, stepUp } = require('./lib.cjs');
async function vxPick(page, loc, text) { await loc.click({ force: true }); if (text) await page.keyboard.type(text, { delay: 30 }); await page.waitForTimeout(1500); const opts = await page.locator('[role=option]').allInnerTexts(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(800); return opts; }
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); console.log(`[${name}] url=${page.url().split('/e/')[1]} errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n))}`); await shot(page, `f-apr-${name}`); };
  if (!process.env.SKIP_PO && !process.env.ONLY_PAY) { await go(page, 'purchasing/orders/new');
  await step('po-valido', async () => {
    await vxPick(page, p.getByPlaceholder('Buscar o seleccionar…').first(), 'QA-Prov');
    const row = p.locator('tbody tr').first();
    await vxPick(page, row.locator('input[role=combobox]').first(), 'QA-Producto');
    const nums = row.locator('input[type=number], input[inputmode=decimal]');
    await nums.nth(0).fill('10'); await nums.nth(1).fill('550'); await nums.nth(2).fill('0.18');
    await page.waitForTimeout(800);
    console.log('TOTALES', (await panelText(page)).split('Subtotal')[1]?.replace(/\n+/g, ' ').slice(0, 120));
    await click(page, 'Guardar', { exact: true });
    console.log('STEPUP', JSON.stringify(await stepUp(page)));
  });
  await step('po-detalle', async () => { console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 700)); console.log('BOTONES', JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean))); });
  }
  if (!process.env.ONLY_PAY) {
  await go(page, 'accounts-payable');
  await step('ap-lista', async () => { console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 500)); await p.getByText('B0100000123').first().click(); await page.waitForTimeout(2000); });
  await step('ap-enviar', async () => { await click(page, 'Enviar a aprobación'); await page.getByRole('button', { name: 'Aceptar' }).click(); await page.waitForTimeout(2000); console.log('STEPUP', JSON.stringify(await stepUp(page))); console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 300)); });
  await go(page, 'approvals');
  await step('aprobaciones', async () => { console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 800)); console.log('BOTONES', JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean))); });
  await go(page, 'my-work');
  await step('mi-trabajo', async () => { console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 600)); });
  }
  await go(page, 'accounts-payable/payments');
  await step('pago-form', async () => {
    const acc = p.getByPlaceholder(/Buscar o seleccionar|Selecciona/).first();
    await acc.click({ force: true }); await page.waitForTimeout(1200);
    console.log('CUENTAS', await page.locator('[role=option]').allInnerTexts());
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
    console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 700));
  });
  await step('pago-registrar', async () => {
    await p.getByText('DOP 5,000.00').first().click();
    await page.waitForTimeout(800);
    console.log('ANTES', (await panelText(page)).replace(/\n+/g, ' | ').slice(0, 700));
    await click(page, 'Registrar pago');
    console.log('STEPUP', JSON.stringify(await stepUp(page)));
    await page.getByRole('button', { name: 'Aceptar' }).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(2000);
  });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
