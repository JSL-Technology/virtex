// Contabilidad: asiento manual (vacío, descuadrado, débito+crédito en una línea, fecha futura, válido + doble clic) y consulta.
const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1800); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-250)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 900)}`); await shot(page, `je-${name}`); };
  const acct = async (i, code) => { const cb = p.locator('tbody tr').nth(i).locator('input[type=text]').first(); await cb.click(); await cb.fill(code); await page.waitForTimeout(1300); const o = page.locator('[role=option]'); await o.filter({ hasText: code }).first().click(); await page.waitForTimeout(500); };
  const line = async (i, code, d, c) => { await acct(i, code); const r = p.locator('tbody tr').nth(i); await r.locator('input[formcontrolname=debit]').fill(String(d)); await r.locator('input[formcontrolname=credit]').fill(String(c)); };
  await go(page, 'accounting/journal-entries/new');
  await step('1-vacio', async () => { await p.getByRole('button', { name: 'Guardar asiento' }).click(); });
  await step('2-descuadrado', async () => { await p.locator('select[formcontrolname=ledgerId]').selectOption({ label: 'Libro principal' }); await p.locator('select').nth(1).selectOption({ label: 'Diario general' }); await p.locator('input[formcontrolname=description]').first().fill('QA3-JE-2290 alquiler oficina'); await line(0, '5', 1500, 0); await line(1, '1120', 0, 1400); await p.getByRole('button', { name: 'Guardar asiento' }).click(); });
  await step('3-deb-y-cred', async () => { await line(1, '1120', 100, 1500); await p.getByRole('button', { name: 'Guardar asiento' }).click(); });
  await step('4-fecha-futura', async () => { await line(1, '1120', 0, 1500); await p.locator('input[type=date]').first().fill('2031-05-01'); await p.getByRole('button', { name: 'Guardar asiento' }).click(); });
  await step('5-valido-dblclick', async () => { await p.locator('input[type=date]').first().fill('2026-10-28'); console.log('   FORM', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 700)); await p.getByRole('button', { name: 'Guardar asiento' }).dblclick(); await page.waitForTimeout(2500); });
  await go(page, 'accounting/journal-entries');
  await step('6-lista', async () => { console.log('   LISTA', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 1500)); });
  await step('7-abrir', async () => { const row = p.locator('tbody tr').filter({ hasText: 'QA3-JE-2290' }).first(); await row.click(); await page.waitForTimeout(2500); console.log('   DOC', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 1000)); console.log('   BOTONES', JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean))); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
