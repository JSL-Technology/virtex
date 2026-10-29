const { session, MX, shot, panel, errors, text, go, resetThrottle, EVID } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-mx.json', MX);
  for (const p of ['reports/financial-statements/balance-sheet', 'invoices', 'accounting/chart-of-accounts']) {
    await go(page, p); await page.waitForTimeout(1500);
    const before = await page.evaluate(() => document.querySelectorAll('[role=menu],[role=menuitem],[role=dialog]').length);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), panel(page).getByRole('button', { name: 'Exportar' }).click()]);
    await page.waitForTimeout(800);
    const pop = await page.evaluate(() => [...document.querySelectorAll('[role=menu],[role=menuitem],[role=dialog],[role=listbox]')].filter(e => e.offsetParent).map(e => e.getAttribute('role') + ':' + e.innerText.replace(/\s+/g, ' ').slice(0, 120)));
    console.log(p, '| descarga:', dl && dl.suggestedFilename(), '| popups:', pop, '| toasts:', await errors(page));
    if (dl) { await dl.saveAs(EVID + '/T-exp-' + p.split('/').pop() + '.' + dl.suggestedFilename().split('.').pop()); }
    else await shot(page, 'T-exp-' + p.split('/').pop());
    if (pop.length) { const it = page.locator('[role=menuitem]').first(); const [d2] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), it.click().catch(() => {})]); console.log('  item1 →', d2 && d2.suggestedFilename()); if (d2) await d2.saveAs(EVID + '/T-exp-' + p.split('/').pop() + '-1.' + d2.suggestedFilename().split('.').pop()); }
  }
  console.log(log.req.filter(r => /export/.test(r)).join('\n'));
  await close();
})();
