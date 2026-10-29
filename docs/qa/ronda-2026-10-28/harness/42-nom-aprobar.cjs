const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll, ADMIN } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  const creds = process.env.U ? { email: process.env.U, password: process.env.PW } : ADMIN;
  if (process.env.PW) process.env.STEPUP_PASS = process.env.PW;
  await uiLogin(page, creds);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(2000); const k = await stepUpAll(page); await page.waitForTimeout(1500); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-250)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 1000)}\n   DOC=${(await panelText(page)).replace(/\s+/g, ' ').slice(0, 400)}`); await shot(page, `noma-${name}-${(process.env.U || 'admin').split('@')[0]}`); };
  const confirm = async () => { const d = page.locator('[role=dialog]').last(); if (await d.count()) { console.log('   DLG', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 400)); const sel = d.locator('select, input[type=text]'); if (await sel.count()) { console.log('   DLG-CTRLS', JSON.stringify(await d.locator('select option').allInnerTexts())); } if (process.env.PICK) { const cb = d.locator('input[type=text]').first(); if (await cb.count()) { await cb.click(); await cb.fill(process.env.PICK); await page.waitForTimeout(1200); await page.locator('[role=option]').first().click(); } const s = d.locator('select').first(); if (await s.count()) await s.selectOption({ index: 1 }); } await d.getByRole('button').last().click(); await page.waitForTimeout(2000); } };
  await go(page, 'payroll/runs'); await p.locator('tbody tr').first().locator('a, td').first().click(); await page.waitForTimeout(2500); await stepUpAll(page); await page.waitForTimeout(2000);
  const act = process.env.ACT || 'Aprobar';
  await step(`${act}`, async () => { await p.getByRole('button', { name: act }).first().click(); await page.waitForTimeout(1200); await confirm(); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
