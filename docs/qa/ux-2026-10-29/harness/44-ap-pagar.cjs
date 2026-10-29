const { session, MX, shot, panel, errors, text, go, resetThrottle } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-mx.json', MX);
  await go(page, 'accounts-payable'); await panel(page).locator('tbody tr').first().click(); await page.waitForTimeout(2500);
  await panel(page).getByText('Pagar', { exact: true }).click(); await page.waitForTimeout(2500);
  console.log('URL', page.url()); await shot(page, 'T-ap-6-pago-form', true);
  const d = page.locator('[role=dialog]').last(); const root = (await d.isVisible().catch(() => false)) ? d : panel(page);
  console.log((await root.innerText()).replace(/\n{2,}/g, '\n').slice(0, 1500));
  console.log((await root.locator('input,select').evaluateAll(es => es.filter(e => e.offsetParent).map(e => (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || '?') + '=' + (e.tagName === 'SELECT' ? e.selectedOptions[0]?.text + ' (' + e.options.length + ')' : e.value)))).join('\n'));
  const b = root.getByRole('button', { name: /Registrar|Pagar|Guardar|Confirmar/ }).last(); console.log('btn', await b.innerText(), await b.isEnabled());
  await b.click(); await page.waitForTimeout(1500);
  console.log('dialogo a11y:', await page.evaluate(() => { const h = [...document.querySelectorAll('h1,h2,h3,div')].find(e => e.innerText && e.innerText.trim() === 'La cuenta quedará en negativo'); const dl = h && h.closest('[role]'); return dl ? dl.getAttribute('role') + ' modal=' + dl.getAttribute('aria-modal') + ' labelledby=' + dl.getAttribute('aria-labelledby') : 'sin role'; }), 'foco=', await page.evaluate(() => document.activeElement.innerText || document.activeElement.tagName));
  await page.getByRole('button', { name: 'Pagar de todos modos' }).click(); await page.waitForTimeout(6000); await shot(page, 'T-ap-8-stepup');
  const sd = page.locator('[role=dialog]').last(); if (await sd.isVisible().catch(() => false)) { console.log('STEPUP DLG:', (await sd.innerText()).replace(/\n+/g,' / ')); const pw = sd.locator('input[type=password]'); if (await pw.count()) { await pw.fill('QA-Test-Pass-2026!'); await sd.getByRole('button').last().click(); await page.waitForTimeout(4000); await shot(page, 'T-ap-9-tras-stepup'); } } console.log('pago →', page.url(), await errors(page)); await shot(page, 'T-ap-7-pagada', true);
  console.log((await text(page)).slice(0, 500));
  console.log(log.req.filter(r => /pay/.test(r)).slice(-5).join('\n'));
  await close();
})();
