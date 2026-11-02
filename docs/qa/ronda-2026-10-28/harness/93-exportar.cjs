const { chromium } = require('playwright');
const { instrument, go, panel, BASE, netSince, toasts } = require('./lib.cjs');
(async () => {
  const browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES', acceptDownloads: true });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await context.newPage(); const log = instrument(page);
  await page.goto(`${BASE}/es/auth/login`); await page.locator('input[type=password]').waitFor();
  await page.locator('input[type=email], input[formcontrolname=email]').first().fill('qa3-admin2@example.com'); await page.locator('input[type=password]').first().fill('QA3-Pass-Segura-2026!'); await page.locator('button[type=submit]').first().click(); await page.waitForURL((u) => !u.pathname.includes('/auth/')); await page.waitForTimeout(2000);
  const p = panel(page);
  for (const r of ['sales/history', 'reports/financial-statements/trial-balance', 'reports/financial-statements/balance-sheet', 'reports/financial-statements/income-statement', 'reports/financial-statements/cash-flow']) {
    await go(page, r); await page.waitForTimeout(2000);
    const b = p.getByRole('button', { name: /^Exportar/ }).first(); if (!(await b.count())) { console.log(r, 'sin botón Exportar'); continue; }
    const n = log.requests.length; const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await b.click(); await page.waitForTimeout(800);
    const menu = page.locator('[role=menu]').last(); if (await menu.count()) { const it = menu.getByRole('menuitem').first(); console.log('   menú', (await menu.innerText()).replace(/\s+/g, ' | ')); await it.click(); }
    const d = await dl; let info = 'SIN DESCARGA'; if (d) { const f = `/tmp/claude-0/exp-${d.suggestedFilename()}`; await d.saveAs(f); info = `${d.suggestedFilename()} ${require('fs').statSync(f).size}B`; }
    console.log(r.padEnd(46), info, JSON.stringify(netSince(log, n)).slice(0, 200), (await toasts(page)).replace(/\s+/g, ' ').slice(-120));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
