const { chromium } = require('playwright');
const { instrument, shot, BASE } = require('./lib.cjs');
(async () => {
  const browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-ES', isMobile: true, hasTouch: true });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await context.newPage(); instrument(page);
  await page.goto(`${BASE}/es/auth/login`); await page.locator('input[type=password]').waitFor({ timeout: 30000 });
  await page.locator('input[type=email], input[formcontrolname=email]').first().fill('qa3-admin2@example.com'); await page.locator('input[type=password]').first().fill('QA3-Pass-Segura-2026!'); await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/auth/'), { timeout: 30000 }); await page.waitForTimeout(2500);
  for (const r of ['overview', 'invoices', 'invoices/new', 'contacts/customers/new', 'reports/financial-statements/trial-balance']) {
    await page.evaluate((u) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }, `/e/virtex-dev/${r}`); await page.waitForTimeout(2500);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, panel: (document.querySelector('.dv-content-container')?.getBoundingClientRect().width) || 0 }));
    console.log(r, JSON.stringify(m)); await shot(page, `movil-${r.replace(/\//g, '_')}`);
  }
  const menu = page.getByRole('button', { name: 'Menú' }); console.log('menu btn', await menu.count()); if (await menu.count()) { await menu.click(); await page.waitForTimeout(1000); await shot(page, 'movil-menu'); }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
