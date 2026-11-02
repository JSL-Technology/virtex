const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1800); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-220)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 900)}\n   botones=${JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean))}`); await shot(page, `fpp-${name}`); };
  const dlgConfirm = async () => { const d = page.locator('[role=dialog], [role=alertdialog]').last(); if (await d.count()) { console.log('   DLG', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 300)); const b = d.getByRole('button').last(); await b.click(); await page.waitForTimeout(1500); } };
  await go(page, 'accounts-payable'); console.log('LISTA', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 500));
  await p.locator('tbody tr').first().click(); await page.waitForTimeout(2500);
  console.log('DOC', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 1000));
  await step('1-enviar-aprob', async () => { await p.getByRole('button', { name: 'Enviar a aprobación' }).click(); await page.waitForTimeout(1000); await dlgConfirm(); });
  await step('1b-doc', async () => { console.log('   DOC', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 600)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
