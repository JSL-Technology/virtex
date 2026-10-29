// Ventas: recibo de cliente parcial y total contra FAC-00000001; refresco de listas; asientos.
const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-250)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 1200)}`); await shot(page, `cob-${name}`); };
  const p = panel(page);
  const combo = async (idx, q, pick) => { const cb = p.locator('input[type=text]').nth(idx); await cb.click(); await cb.fill(q); await page.waitForTimeout(1500); const o = page.locator('[role=option]'); console.log('OPC', JSON.stringify(await o.allInnerTexts())); await o.filter({ hasText: pick || q }).first().click(); await page.waitForTimeout(1200); };
  // Abrir lista de facturas (queda abierta para probar el refresco)
  await go(page, 'invoices');
  await go(page, 'customer-receipts/new');
  await step('1-vacio', async () => { await p.getByRole('button', { name: 'Guardar' }).click(); });
  await step('2-parcial', async () => {
    await combo(0, 'QA3-8812');
    await p.locator('input[formcontrolname=amountReceived]').fill('1000');
    await combo(1, 'QA3-6620');
    await page.waitForTimeout(1500);
    console.log('FORM', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 1500));
  });
  await step('2b-guardar', async () => { await p.getByRole('button', { name: 'Guardar' }).click(); await page.waitForTimeout(2000); console.log('POST', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 700)); });
  await go(page, 'invoices');
  await step('3-lista-tras-parcial', async () => { console.log((await panelText(page)).replace(/\s+/g, ' ').slice(0, 500)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
