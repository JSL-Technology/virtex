// OC PO-2026-000001: enviar a aprobación → ver acciones disponibles → recibir mercancía → stock.
const { launch, instrument, uiLogin, shot, go, click, panel, panelText, netSince, errorsShown, stepUp } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); console.log(`[${name}] url=${page.url().split('/e/')[1]} errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n))}\n   texto=${(await panelText(page)).replace(/\n+/g, ' | ').slice(0, 600)}\n   botones=${JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean))}`); await shot(page, `f-po-${name}`); };
  await go(page, 'purchasing/orders');
  await step('1-abrir', async () => { await p.getByText('PO-2026-000001').first().click(); await page.waitForTimeout(2000); });
  if (!process.env.AFTER_APPROVE) await step('2-enviar', async () => { await click(page, 'Enviar a aprobación'); await page.getByRole('button', { name: /Aceptar|Confirmar/ }).click({ timeout: 3000 }).catch(() => {}); console.log('STEPUP', JSON.stringify(await stepUp(page))); await page.waitForTimeout(1500); });
  for (const b of ['Aprobar', 'Marcar como enviada', 'Recibir', 'Registrar recepción', 'Recepción', 'Recibir todo']) {
    const btn = p.getByRole('button', { name: new RegExp(b, 'i') });
    if (await btn.count()) { await step(`3-${b}`, async () => { await btn.first().click(); await page.getByRole('button', { name: /Aceptar|Confirmar/ }).click({ timeout: 3000 }).catch(() => {}); console.log('STEPUP', JSON.stringify(await stepUp(page))); }); }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
