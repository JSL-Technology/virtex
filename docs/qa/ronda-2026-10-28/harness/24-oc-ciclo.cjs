// OC: enviar a aprobación → aprobar (mismo usuario: SoD) → enviar → recepción parcial y total; stock y asientos.
const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1800); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-220)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 900)}\n   botones=${JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean))}`); await shot(page, `oc-${name}`); };
  const confirmDlg = async () => { const d = page.locator('[role=dialog], [role=alertdialog]').last(); if (await d.count()) { console.log('   DLG', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 300)); const b = d.getByRole('button').filter({ hasText: /Confirmar|Aceptar|Sí|Aprobar|Enviar|Registrar/ }).last(); if (await b.count()) await b.click(); await page.waitForTimeout(1500); } };
  await go(page, 'purchasing/orders'); await p.locator('tbody tr').first().click(); await page.waitForTimeout(2500);
  const ocUrl = page.url().split('/e/virtex-dev/')[1];
  await step('1-enviar-aprob', async () => { await p.getByRole('button', { name: 'Enviar a aprobación' }).click(); await page.waitForTimeout(1000); await confirmDlg(); });
  await step('2-aprobar', async () => { const b = p.getByRole('button', { name: /^Aprobar/ }); console.log('   aprobar existe', await b.count()); if (await b.count()) { await b.first().click(); await page.waitForTimeout(1000); await confirmDlg(); } });
  await go(page, 'approvals'); await step('2b-bandeja', async () => { console.log('   APROB', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 500)); });
  await go(page, 'workflow-tasks'); await step('2c-tareas', async () => { console.log('   TAREAS', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 400)); });
  await go(page, ocUrl);
  await step('3-estado', async () => { console.log('   DOC', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 400)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
