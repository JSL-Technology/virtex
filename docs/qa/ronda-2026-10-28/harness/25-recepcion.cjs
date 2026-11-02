const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1800); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-220)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 900)}\n   botones=${JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean))}`); await shot(page, `rec-${name}`); };
  await go(page, 'purchasing/orders'); await p.locator('tbody tr').first().click(); await page.waitForTimeout(2500);
  await step('1-enviada', async () => { await p.getByRole('button', { name: 'Marcar como enviada al proveedor' }).click(); });
  await go(page, 'purchasing/receipts/new');
  await step('2-vacio', async () => { await p.getByRole('button', { name: 'Registrar recepción' }).click(); });
  await step('3-oc', async () => { const cb = p.locator('input[type=text]').first(); await cb.click(); await page.waitForTimeout(1200); const o = page.locator('[role=option]'); console.log('   OPC', JSON.stringify(await o.allInnerTexts())); await o.first().click(); await page.waitForTimeout(1500); console.log('   FORM', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 900)); });
  await step('4-sobre', async () => { const q = p.locator('tbody input[type=number]').first(); await q.fill('15'); await p.getByRole('button', { name: 'Registrar recepción' }).click(); });
  await step('5-parcial', async () => { const q = p.locator('tbody input[type=number]').first(); await q.fill('4'); await p.getByRole('button', { name: 'Registrar recepción' }).click(); await page.waitForTimeout(1500); console.log('   POST', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 600)); });
  await go(page, 'purchasing/orders'); await step('6-lista-oc', async () => { console.log('   OCS', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 400)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
