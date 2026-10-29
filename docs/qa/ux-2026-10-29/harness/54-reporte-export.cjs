const { session, MX, shot, panel, errors, text, go, resetThrottle, EVID } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-mx.json', MX, { });
  await go(page, 'reports/financial-statements/balance-sheet'); await page.waitForTimeout(2000);
  await shot(page, 'T-rep-1-balance-mx', true); console.log((await text(page)).slice(0, 1500));
  await panel(page).getByRole('button', { name: 'Exportar' }).click(); await page.waitForTimeout(1200);
  await shot(page, 'T-rep-2-exportar-menu');
  const items = await page.locator('[role=menuitem], [role=menu] button, .dropdown-menu button, [class*=menu] button').allInnerTexts(); console.log('MENU', items.map(s => s.trim()).filter(Boolean));
  const target = page.locator('[role=menuitem]').filter({ hasText: /PDF/ }).first();
  if (await target.count()) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(e => null), target.click()]);
    if (dl) { const p = EVID + '/T-rep-3-balance.' + (dl.suggestedFilename().split('.').pop()); await dl.saveAs(p); console.log('descarga', dl.suggestedFilename(), '→', p); } else { await page.waitForTimeout(3000); console.log('sin descarga', page.url(), await errors(page)); await shot(page, 'T-rep-3-tras-export'); }
  }
  const x = page.locator('[role=menuitem]').filter({ hasText: /Excel|XLSX|CSV/ }).first();
  await panel(page).getByRole('button', { name: 'Exportar' }).click().catch(() => {}); await page.waitForTimeout(800);
  if (await x.count()) { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), x.click()]); if (dl) { const p = EVID + '/T-rep-4-balance.' + dl.suggestedFilename().split('.').pop(); await dl.saveAs(p); console.log('descarga2', dl.suggestedFilename()); } }
  console.log(log.req.filter(r => /export|report|balance/.test(r)).slice(-6).join('\n'));
  await close();
})();
