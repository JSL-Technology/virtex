const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1800); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-250)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 900)}`); await shot(page, `ce-${name}`); };
  await go(page, 'accounting/chart-of-accounts');
  const s = p.locator('input[type=search], input[placeholder*=uscar]').first(); await s.fill('5915'); await page.waitForTimeout(1200);
  await step('1-editar', async () => { await p.getByRole('button', { name: /Editar/ }).first().click(); await page.waitForTimeout(2000); console.log('   FORM', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 700)); });
  await step('2-guardar', async () => { await p.locator('[formcontrolname=name]').fill('QA3-5915 Gastos de prueba (editada)'); await p.getByRole('button', { name: /Guardar/ }).first().click(); await page.waitForTimeout(1500); const d = page.locator('[role=dialog]').last(); if (await d.count()) { console.log('   DLG', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 400)); const t = d.locator('textarea, input[type=text]').first(); if (await t.count()) { await t.fill('QA3 corrección de nombre'); } await d.getByRole('button').last().click(); await page.waitForTimeout(2000); } });
  // Asiento en enero cerrado
  await go(page, 'accounting/journal-entries/new');
  await step('3-asiento-cerrado', async () => {
    await p.locator('input[type=date]').first().fill('2026-01-15');
    await p.locator('select[formcontrolname=ledgerId]').selectOption({ label: 'Libro principal' }); await p.locator('select').nth(1).selectOption({ label: 'Diario general' }); await p.locator('input[formcontrolname=description]').first().fill('QA3-JE-cerrado');
    for (const [i, code, d, c] of [[0, '5915', 100, 0], [1, '1120', 0, 100]]) { const cb = p.locator('tbody tr').nth(i).locator('input[type=text]').first(); await cb.click(); await cb.fill(code); await page.waitForTimeout(1300); await page.locator('[role=option]').filter({ hasText: code }).first().click(); const r = p.locator('tbody tr').nth(i); await r.locator('input[formcontrolname=debit]').fill(String(d)); await r.locator('input[formcontrolname=credit]').fill(String(c)); }
    await p.getByRole('button', { name: 'Guardar asiento' }).click(); await page.waitForTimeout(2000);
  });
  await go(page, 'accounting/periods');
  await step('4-reabrir', async () => { await p.getByRole('button', { name: 'Reabrir' }).first().click(); await page.waitForTimeout(1200); const d = page.locator('[role=dialog]').last(); console.log('   DLG', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 400)); const btn = d.getByRole('button').last(); console.log('   deshab-sin-motivo', await btn.isDisabled()); const t = d.locator('textarea, input[type=text]').first(); await t.fill('QA3 reapertura de prueba'); await btn.click(); await page.waitForTimeout(2500); console.log('   PER', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 250)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
