const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  page.on('dialog', (d) => d.accept());
  process.env.STEPUP_PASS = 'QA3-Pass-Segura-2026!';
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(2000); await stepUpAll(page); console.log(`[${name}] url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-200)}" err=${JSON.stringify(await errorsShown(page)).slice(0, 250)}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 500)}\n   UI=${(await panelText(page)).replace(/\s+/g, ' ').slice(0, 500)}\n   BTN=${JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean)).slice(0, 300)}`); await shot(page, `cot-${name}`); };
  await go(page, 'quotes/new');
  await step('1-vacio', async () => { await p.getByRole('button', { name: 'Guardar' }).click(); });
  await step('2-llenar', async () => {
    const cb = p.locator('input[type=text]').first(); await cb.click(); await cb.fill('QA3-IMP-5501'); await page.waitForTimeout(1500); await page.locator('[role=option]').filter({ hasText: 'QA3-IMP-5501' }).first().click();
    const row = p.locator('tbody tr').last(); const art = row.locator('input[type=text]').first(); await art.click({ force: true }); await art.fill('QA3-5521'); await page.waitForTimeout(1500); await page.locator('[role=option]').filter({ hasText: 'QA3-5521' }).first().click(); await page.waitForTimeout(600);
    await row.locator('input[type=number]').first().fill('2');
    const d = p.locator('input[type=date]'); if (await d.count() > 1) await d.nth(1).fill('2026-10-01');
    await p.getByRole('button', { name: 'Guardar' }).click();
  });
  await step('3-vigencia-ok', async () => { const d = p.locator('input[type=date]'); if (await d.count() > 1) await d.nth(1).fill('2026-11-30'); await p.getByRole('button', { name: 'Guardar' }).click(); await page.waitForTimeout(2000); });
  for (const b of ['Enviar', 'Marcar como enviada', 'Aceptada', 'Marcar como aceptada', 'Aceptar']) { const x = p.getByRole('button', { name: new RegExp('^' + b) }).first(); if (await x.count()) await step(`4-${b}`, async () => { await x.click(); await page.waitForTimeout(1000); const d = page.locator('[role=dialog]').last(); if (await d.count()) { console.log('   DLG', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 200)); await page.keyboard.press('Escape'); } }); }
  const conv = p.getByRole('button', { name: /Convertir|factura/i }).first();
  if (await conv.count()) await step('5-convertir', async () => { await conv.click(); await page.waitForTimeout(2500); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
