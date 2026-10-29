const { session, ADMIN, shot, panel, errors, text, resetThrottle, BASE, EVID } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, context, log, close } = await session('state-admin.json', ADMIN);
  await page.goto(BASE + '/e/virtex-dev/invoices'); await page.waitForTimeout(3500);
  await panel(page).locator('tbody tr').filter({ hasText: 'B0200000001' }).first().click(); await page.waitForTimeout(3000);
  const [dl, pop] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), context.waitForEvent('page', { timeout: 15000 }).catch(() => null), panel(page).getByRole('button', { name: 'PDF' }).click()]);
  if (dl) { await dl.saveAs(EVID + '/D-factura.pdf'); console.log('PDF descargado', dl.suggestedFilename()); }
  else if (pop) { await pop.waitForTimeout(4000); console.log('PDF en pestaña', pop.url().slice(0, 80)); await pop.screenshot({ path: EVID + '/D-factura-pdf-tab.png' }).catch(() => {}); }
  else { await page.waitForTimeout(3000); console.log('PDF: nada', await errors(page)); await shot(page, 'D-pdf-nada'); }
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await panel(page).getByRole('button', { name: 'Imprimir' }).click(); await page.waitForTimeout(2500);
  console.log('print() llamado', await page.evaluate(() => window.__printed));
  await page.emulateMedia({ media: 'print' }); await page.pdf({ path: EVID + '/D-factura-impresion.pdf', format: 'Letter' }).catch(e => console.log('pdf err', e.message)); await page.emulateMedia({ media: 'screen' });
  // POS
  const pos = await context.newPage(); await pos.goto('http://localhost:4300/'); await pos.waitForTimeout(5000);
  console.log('POS', pos.url(), await pos.title()); await pos.screenshot({ path: EVID + '/P-1-pos.png' });
  console.log((await pos.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 600));
  await close();
})();
