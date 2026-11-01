const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page);
  await go(page, 'datasheets'); await page.waitForTimeout(1500);
  const el = p.getByText('Nuevo libro').first(); console.log('EL', await el.evaluate((e) => e.outerHTML.slice(0, 300)));
  let n = log.requests.length; await el.click(); await page.waitForTimeout(3000);
  console.log('[nuevo]', page.url().split('/e/')[1], JSON.stringify(netSince(log, n)).slice(0, 500), (await toasts(page)).slice(-150));
  const d = page.locator('[role=dialog]').last(); if (await d.count()) console.log('DLG', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 500));
  console.log('UI', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 800));
  await shot(page, 'ds-nuevo');
  n = log.requests.length; await p.getByText('Importar ERP').first().click(); await page.waitForTimeout(2000);
  const d2 = page.locator('[role=dialog]').last(); const t2 = (await (await d2.count() ? d2 : p).innerText()).replace(/\s+/g, ' '); console.log('[importar-erp]', JSON.stringify(netSince(log, n)).slice(0, 300), t2.slice(0, 700));
  const sel = (await d2.count() ? d2 : p).locator('select').first(); if (await sel.count()) { console.log('OPTS', JSON.stringify(await sel.locator('option').allInnerTexts())); await sel.selectOption({ index: 1 }); await page.waitForTimeout(1000); }
  const go2 = (await d2.count() ? d2 : p).getByRole('button', { name: /Importar|Insertar|Aceptar/ }).last(); n = log.requests.length; if (await go2.count()) { await go2.click(); await page.waitForTimeout(3000); }
  console.log('[tras-importar]', JSON.stringify(netSince(log, n)).slice(0, 400), (await panelText(page)).replace(/\s+/g, ' ').slice(0, 600));
  await shot(page, 'ds-importado');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
