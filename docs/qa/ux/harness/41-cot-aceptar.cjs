const { launch, login, shot, instrument, nav } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Ventas', 'Cotizaciones');
  const P = page.locator('.dv-active-group .dv-content-container');
  await shot(page, 'F-cot-5-lista');
  await P.getByText('COT-00000001').first().click(); await page.waitForTimeout(3000);
  await shot(page, 'F-cot-6-detalle');
  
  console.log('dlg', await page.locator('[role=dialog], [role=alertdialog]').allInnerTexts());
  const c = page.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: /Confirmar|Aceptar|Sí/ }).last(); if (await c.count()) { await c.click(); await page.waitForTimeout(2500); }
  console.log('ALERT', await page.locator('[role=alert], .toast').allInnerTexts());
  await shot(page, 'F-cot-7-aceptada');
  console.log('ACCIONES', (await P.locator('button:visible').allInnerTexts()).filter(Boolean).join(' | '));
  const conv = P.getByRole('button', { name: /factura/i }).first();
  if (await conv.count()) { await conv.click(); await page.waitForTimeout(1500); const ab = await page.evaluate(() => { const b=[...document.querySelectorAll('button')].filter(x=>x.innerText.trim()==='Convertir en factura'); const d=b[b.length-1]?.closest('[role],[class*=dialog],[class*=modal]'); return { role: d?.getAttribute('role'), cls: d?.className?.toString().slice(0,80), ariaModal: d?.getAttribute('aria-modal'), focus: document.activeElement?.innerText?.slice(0,30) }; }); console.log('DIALOG A11Y', JSON.stringify(ab)); await page.getByRole('button', { name: 'Convertir en factura' }).last().click(); await page.waitForTimeout(3500); console.log('tras convertir', page.url(), await page.locator('[role=alert], .toast').allInnerTexts()); await shot(page, 'F-cot-8-convertida'); }
  console.log(log.req.filter(r => /quote|invoice/.test(r) && !/GET/.test(r)).join('\n'));
  await browser.close();
})();
