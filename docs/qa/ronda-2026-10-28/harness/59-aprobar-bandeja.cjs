const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  process.env.STEPUP_PASS = 'QA3-Pass-Segura-2026!';
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page);
  await go(page, 'approvals'); await page.waitForTimeout(2000);
  console.log('BANDEJA', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 500));
  console.log('BOTONES', JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean)));
  const card = p.locator('*').filter({ hasText: /^.*REQ-2026-000001/ }).last();
  let n = log.requests.length;
  const ap = p.getByRole('button', { name: /^Aprobar/ }).first(); if (await ap.count()) { await ap.click(); await page.waitForTimeout(1000); const d = page.locator('[role=dialog]').last(); if (await d.count()) { console.log('DLG', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 300)); const t = d.locator('textarea').first(); if (await t.count()) await t.fill('QA3 aprobado'); await d.getByRole('button').last().click(); } await page.waitForTimeout(2000); await stepUpAll(page); }
  console.log('[aprobar]', JSON.stringify(netSince(log, n)).slice(0, 500), (await toasts(page)).replace(/\s+/g, ' ').slice(-150));
  console.log('BANDEJA2', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 400));
  await shot(page, 'apr-admin2');
  await go(page, 'purchasing/requisitions'); await p.locator('tbody tr').first().click(); await page.waitForTimeout(2500);
  console.log('REQ', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 200), JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean)));
  n = log.requests.length; const cv = p.getByRole('button', { name: /Convertir|orden de compra/ }).first(); if (await cv.count()) { await cv.click(); await page.waitForTimeout(2500); const d = page.locator('[role=dialog]').last(); if (await d.count()) { console.log('DLG2', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 400)); } }
  console.log('[convertir]', JSON.stringify(netSince(log, n)).slice(0, 400), page.url().split('/e/')[1], (await panelText(page)).replace(/\s+/g, ' ').slice(0, 300));
  await shot(page, 'req-convertir');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
