// Ventas: factura (vacío, cliente RNC sin rango B01, consumidor final B02, descuento %, emitir, detalle y barra de acciones).
const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  page.on('popup', (p) => console.log('POPUP', p.url()));
  await uiLogin(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); console.log(`[${name}] url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-250)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 1500)}`); await shot(page, `fac-${name}`); };
  const p = panel(page);
  const pickCustomer = async (q) => {
    const cb = p.locator('input[type=text]').first();
    await cb.click(); await cb.fill(q); await page.waitForTimeout(1500);
    const opts = page.locator('[role=option]');
    console.log('OPCIONES-CLIENTE', JSON.stringify(await opts.allInnerTexts()));
    await opts.filter({ hasText: q }).first().click();
  };
  const addLine = async (q, qty, disc) => {
    const row = p.locator('tbody tr').last();
    const art = row.locator('input[type=text]').first();
    console.log('ANCHO-ARTICULO', JSON.stringify(await art.boundingBox()));
    await art.click({ force: true }); await art.fill(q); await page.waitForTimeout(1500);
    const opts = page.locator('[role=option]');
    console.log('OPCIONES-ART', JSON.stringify(await opts.allInnerTexts()));
    await opts.filter({ hasText: q }).first().click();
    await page.waitForTimeout(800);
    await row.locator('input[formcontrolname=quantity]').fill(String(qty));
    if (disc != null) await row.locator('input[formcontrolname=discountRate]').fill(String(disc));
    await page.waitForTimeout(800);
  };
  const summary = async () => (await p.innerText()).match(/Subtotal[\s\S]{0,300}/)?.[0].replace(/\s+/g, ' ');
  await go(page, 'invoices/new');
  await step('0-inicial', async () => { console.log((await panelText(page)).replace(/\s+/g, ' ').slice(0, 1200)); console.log('MONEDA', await p.locator('select[formcontrolname=currencyCode]').inputValue()); });
  await step('1-vacio-emitir', async () => { await p.getByRole('button', { name: 'Emitir factura' }).click(); });
  await step('2-cliente-rnc', async () => { await pickCustomer('QA3-8812'); });
  await step('3-linea-desc', async () => { await addLine('QA3-7734', 2, 10); console.log('RESUMEN desc=10', await summary()); });
  await step('4-emitir-rnc', async () => { await p.getByRole('button', { name: 'Emitir factura' }).click(); await page.waitForTimeout(2500); });
  await step('4b-post', async () => { console.log((await panelText(page)).replace(/\s+/g, ' ').slice(0, 1500)); });
  await step('5-detalle', async () => { console.log('BOTONES', JSON.stringify(await p.getByRole('button').allInnerTexts())); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
