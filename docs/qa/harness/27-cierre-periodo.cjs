// Cierre de período (enero 2026, sin movimientos, entorno local QA) y verificación de bloqueo.
const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, errorsShown, stepUp, toasts } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(2000); console.log(`[${name}] errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n))}\n   texto=${(await panelText(page)).replace(/\n+/g, ' | ').slice(0, 450)}`); await shot(page, `f-per-${name}`); };
  await go(page, 'accounting/periods');
  await step('1-cerrar-marzo-primero', async () => { await p.locator('tbody tr').nth(2).getByRole('button', { name: /Cerrar/ }).click(); await page.getByRole('button', { name: /Aceptar|Confirmar|Cerrar per/i }).last().click({ timeout: 3000 }).catch(() => {}); console.log('STEPUP', JSON.stringify(await stepUp(page))); console.log('TOAST', (await toasts(page)).slice(-250)); });
  await step('2-cerrar-enero', async () => { await p.locator('tbody tr').nth(0).getByRole('button', { name: /Cerrar/ }).click(); await page.waitForTimeout(800); await shot(page, 'f-per-2a-confirm'); await page.getByRole('button', { name: /Aceptar|Confirmar|Cerrar per/i }).last().click({ timeout: 3000 }).catch(() => {}); console.log('STEPUP', JSON.stringify(await stepUp(page))); console.log('TOAST', (await toasts(page)).slice(-250)); });
  await step('3-estado', async () => { await p.getByRole('button', { name: 'Actualizar' }).click(); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
