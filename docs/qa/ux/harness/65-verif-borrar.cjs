// Verifica A-08: borrar un cliente con documentos explica qué lo usa y ofrece desactivarlo.
const { launch, login } = require('./lib.cjs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'evidence', 'fix');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  page.on('request', (r) => { if (/customers\//.test(r.url())) console.log('REQ', r.method(), r.url().replace(/^.*api.v1/, '')); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
  await login(page);
  const base = page.url().split('/').slice(0, 5).join('/');
  await page.goto(`${base}/contacts/customers`); await page.waitForTimeout(4000);
  const panel = page.locator('.dv-groupview.dv-active-group .dv-content-container').first();
  const rows = panel.locator('tbody tr');
  const n = await rows.count();
  console.log('clientes', n);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const name = (await row.locator('td').first().innerText()).trim();
    if (/consumidor/i.test(name)) continue;
    const del = row.locator('button[aria-label*="liminar"], button.delete, button:has(svg.lucide-trash-2)').first();
    if (!(await del.count())) continue;
    await del.click(); await page.waitForTimeout(1500);
    const dlg = page.locator('[role="dialog"], [role="alertdialog"]').first();
    const text = (await dlg.innerText().catch(() => '')).replace(/\s+/g, ' ');
    console.log(name, '→', text.slice(0, 260));
    await page.screenshot({ path: path.join(OUT, `A08-${i}-borrar-cliente.png`) });
    await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    if (/desactivar/i.test(text)) break;
  }
  await browser.close();
})();
