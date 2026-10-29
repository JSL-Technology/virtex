const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1800); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-220)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 900)}\n   botones=${JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean))}`); await shot(page, `fp-${name}`); };
  await go(page, 'purchasing/orders'); await p.locator('tbody tr').first().click(); await page.waitForTimeout(2500);
  await step('1-crear-desde-oc', async () => { await p.getByRole('button', { name: 'Crear factura de proveedor' }).click(); await page.waitForTimeout(2500); console.log('   FORM', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 1500)); });
  await step('2-guardar-sin-ncf', async () => { await p.getByRole('button', { name: 'Guardar factura' }).click(); });
  await step('3-ncf-invalido', async () => { await p.locator('input[formcontrolname=ncf]').fill('XYZ123'); await p.getByRole('button', { name: 'Guardar factura' }).click(); });
  await step('4-ncf-valido', async () => { await p.locator('input[formcontrolname=ncf]').fill('B0100000045'); await p.getByRole('button', { name: 'Guardar factura' }).click(); await page.waitForTimeout(2000); console.log('   DOC', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 1200)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
