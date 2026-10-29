const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  page.on('dialog', (d) => d.accept());
  await uiLogin(page);
  const p = panel(page);
  await go(page, 'purchasing/requisitions/new');
  console.log('FORM', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 500));
  let n = log.requests.length;
  await p.getByRole('button', { name: 'Guardar' }).click(); await page.waitForTimeout(1200); console.log('[vacio]', JSON.stringify(await errorsShown(page)));
  await p.locator('input[type=date]').first().fill('2026-11-15');
  await p.locator('textarea, input[formcontrolname*=justif]').first().fill('QA3-REQ-4471 reposición de widgets');
  const prod = p.locator('tbody input[type=text]').first(); await prod.click(); await prod.fill('QA3-7734'); await page.waitForTimeout(1200); await page.locator('[role=option]').first().click().catch(() => {});
  const nums = p.locator('tbody input[type=number]'); console.log('nums', await nums.count()); await nums.nth(0).fill('5'); if (await nums.count() > 1) await nums.nth(1).fill('650');
  console.log('MONEDA', await p.locator('select').first().inputValue().catch(() => '?'), (await panelText(page)).replace(/\s+/g, ' ').match(/Total[^A-Z]{0,40}/)?.[0]);
  n = log.requests.length; await p.getByRole('button', { name: 'Guardar' }).click(); await page.waitForTimeout(2500);
  console.log('[guardar]', JSON.stringify(netSince(log, n)).slice(0, 400), 'BOTONES', JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean)));
  n = log.requests.length; await p.getByRole('button', { name: /Enviar a aprobación/ }).click(); await page.waitForTimeout(2000);
  console.log('[enviar]', JSON.stringify(netSince(log, n)).slice(0, 400), 'DOC', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 200));
  for (const r of ['approvals', 'workflow-tasks', 'overview']) { await go(page, r); await page.waitForTimeout(2000); console.log(`[${r}]`, (await panelText(page)).replace(/\s+/g, ' ').slice(0, 500)); await shot(page, `apr-${r}`); }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
