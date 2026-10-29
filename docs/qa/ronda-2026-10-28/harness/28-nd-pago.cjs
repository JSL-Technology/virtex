const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1800); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-220)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 900)}`); await shot(page, `ndp-${name}`); };
  const combo = async (idx, q) => { const cb = p.locator('input[type=text]').nth(idx); await cb.click(); await cb.fill(q); await page.waitForTimeout(1500); const o = page.locator('[role=option]'); console.log('   OPC', JSON.stringify(await o.allInnerTexts()).slice(0, 400)); await o.filter({ hasText: q }).first().click(); await page.waitForTimeout(1000); };
  if (0) {
  await step('nd-1-vacio', async () => { await p.getByRole('button', { name: 'Contabilizar nota' }).click(); });
  await step('nd-2-excede', async () => { const cb = p.locator('input[type=text]').first(); await cb.click(); await page.waitForTimeout(1200); const o = page.locator('[role=option]'); console.log('   OPC', JSON.stringify(await o.allInnerTexts())); await o.first().click(); await page.waitForTimeout(800);
    await p.locator('input[formcontrolname=amount]').fill('99999'); await p.locator('input[formcontrolname=taxAmount]').fill('50000'); await p.locator('textarea[formcontrolname=reason]').fill('QA3 devolución'); await p.getByRole('button', { name: 'Contabilizar nota' }).click(); });
  await step('nd-3-valida', async () => { await p.locator('input[formcontrolname=amount]').fill('767'); await p.locator('input[formcontrolname=taxAmount]').fill('117'); await p.locator('input[formcontrolname=ncf]').fill('B0400000007'); await combo(2, '1140'); await p.locator('textarea[formcontrolname=reason]').fill('QA3-ND devolución de 1 unidad dañada'); await p.getByRole('button', { name: 'Contabilizar nota' }).click(); await page.waitForTimeout(2000); console.log('   DOC', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 700)); });
  }
  await go(page, 'accounts-payable/payments/new');
  await step('pg-1-vacio', async () => { await p.getByRole('button', { name: 'Registrar pago' }).click(); });
  await step('pg-2-form', async () => { await combo(0, 'QA3-6620'); console.log('   FORM', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 900)); });
  await step('pg-3-elegir', async () => { const chips = p.locator('button, [role=button]').filter({ hasText: /3,068|2,301|Sin NCF|QA3-9045/ }); console.log('   CHIPS', JSON.stringify(await chips.allInnerTexts())); if (await chips.count()) await chips.first().click(); await page.waitForTimeout(1000); console.log('   FORM2', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 900)); });
  await step('pg-4-registrar', async () => { await p.locator('input[formcontrolname=reference]').fill('TRF-QA3-0001'); await p.getByRole('button', { name: 'Registrar pago' }).click(); await page.waitForTimeout(1200); const n0 = log.requests.length; await page.getByRole('button', { name: 'Pagar de todos modos' }).click(); await page.waitForTimeout(2500); await stepUpAll(page); console.log('   RED-PAGO', JSON.stringify(netSince(log, n0)).slice(0,1500)); console.log('   DOC', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 600)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
