// Flujo Ventas: crear factura de venta para QA-Cliente-01 con QA-Producto-01 x2 y emitirla.
const { launch, instrument, uiLogin, shot, go, fill, click, panel, panelText, netSince, toasts, errorsShown } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page, { email: 'qa-vendedor@example.com', password: 'QA-Valid-Pass-2026!' });
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); console.log(`[${name}] url=${page.url().split('/e/')[1]} errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n))}`); await shot(page, `f-fac-seller-${name}`); };
  await go(page, 'invoices/new');
  const p = panel(page);
  await step('0-inicial', async () => { console.log((await panelText(page)).slice(0, 600)); });
  const cur = await p.locator('select').first().evaluate((s) => [...s.options].map((o) => o.text.trim())).catch(() => 'sin select'); console.log('MONEDAS', JSON.stringify(cur).slice(0, 200));
  await step('1-vacio', async () => { const b = p.getByRole('button').filter({ hasText: /Guardar|Emitir|Crear/ }); console.log('BOTONES', await b.allInnerTexts()); await b.last().click(); });
  await step('2-cliente', async () => {
    const cb = p.getByPlaceholder(/Busca por nombre/);
    await cb.click(); await cb.fill('QA-Cliente'); await page.waitForTimeout(1500);
    const opts = page.locator('[role=option], .cdk-overlay-pane li, [class*=option]');
    console.log('OPCIONES', await opts.allInnerTexts());
    await opts.first().click();
  });
  await step('3-linea', async () => {
    const row = p.locator('tbody tr').first();
    const art = row.locator('input[aria-label="Artículo"]');
    console.log('ANCHO-INPUT-ARTICULO', JSON.stringify(await art.boundingBox()));
    await row.locator('.vx-select__toggle').first().click({ force: true }); await page.waitForTimeout(1500);
    const opts = page.locator('[role=option], .cdk-overlay-pane li, [class*=option]');
    console.log('OPCIONES-ART', await opts.allInnerTexts());
    const o = opts.filter({ hasText: 'QA-Producto-01' }).first();
    console.log('OPCION-BOX', JSON.stringify(await o.boundingBox()), await o.isVisible());
    await art.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const qty = row.locator('input[type=number]').first();
    await qty.fill('2');
    const disc = row.locator('input[formcontrolname=discountRate]');
    await disc.fill('10'); await page.waitForTimeout(600);
    console.log('DESC=10 -> clases', await disc.getAttribute('class'), 'resumen', (await p.locator('text=Resumen').locator('..').innerText()).replace(/\n/g, ' '));
    await disc.fill('');
    await page.waitForTimeout(800);
    console.log('RESUMEN', (await p.locator('text=Resumen').locator('..').innerText()).replace(/\n/g, ' '));
  });
  await step('4-emitir', async () => { await p.getByRole('button', { name: 'Emitir factura' }).click(); await page.waitForTimeout(2500); console.log('TOAST', (await toasts(page)).slice(-300)); });
  await step('5-post', async () => { console.log((await panelText(page)).slice(0, 900)); console.log('BOTONES', await p.getByRole('button').allInnerTexts()); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
