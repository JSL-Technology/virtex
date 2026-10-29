const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  process.env.STEPUP_PASS = 'QA3-Pass-Segura-2026!';
  await uiLogin(page, { email: 'qa3-vendedor@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1800); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-200)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 900)}`); await shot(page, `vend-${name}`); };
  await go(page, 'contacts/customers/new');
  if(0) await step('1-cliente', async () => { await p.locator('[formcontrolname=companyName]').fill('QA3-6061-Cliente del vendedor'); await p.getByRole('button', { name: 'Guardar cliente' }).click(); });
  await go(page, 'invoices/new');
  await step('2-factura', async () => {
    const cb = p.locator('input[type=text]').first(); await cb.click(); await cb.fill('QA3-6061'); await page.waitForTimeout(1500); await page.locator('[role=option]').filter({ hasText: 'QA3-6061' }).first().click();
    const row = p.locator('tbody tr').last(); const art = row.locator('input[type=text]').first(); await art.click({ force: true }); await art.fill('QA3-7734'); await page.waitForTimeout(1500); await page.locator('[role=option]').filter({ hasText: 'QA3-7734' }).first().click(); await page.waitForTimeout(800);
    await row.locator('input[formcontrolname=quantity]').fill('1');
    console.log('   MONEDA', await p.locator('select[formcontrolname=currencyCode]').inputValue());
    
    await p.getByRole('button', { name: 'Emitir factura' }).click(); await page.waitForTimeout(3000);
  });
  await step('3-anular-intento', async () => { const b = p.getByRole('button', { name: 'Anular' }); console.log('   ve-anular', await b.count(), 've-NC', await p.getByRole('button', { name: 'Nota de crédito' }).count()); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
