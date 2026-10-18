// Verifica A-16, M-13, M-19, M-21: reportes contables, períodos, plan de cuentas y libro diario.
const { launch, login } = require('./lib.cjs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'evidence', 'fix');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await login(page);
  const base = page.url().split('/').slice(0, 5).join('/');
  const visit = async (route, name, check) => {
    await page.goto(`${base}/${route}`); await page.waitForTimeout(4500);
    const panel = page.locator('.dv-groupview.dv-active-group .dv-content-container').first();
    const info = await panel.evaluate(check).catch((e) => 'ERR ' + e.message);
    console.log(name, '→', JSON.stringify(info));
    await page.screenshot({ path: path.join(OUT, name + '.png') });
  };
  await visit('reports/financial-statements/cash-flow', 'A16-1-flujo-efectivo-nombres', (el) => ({
    h1: el.querySelector('h1')?.innerText, font: getComputedStyle(el.querySelector('.report-container') || el).fontFamily.slice(0, 30),
    lines: [...el.querySelectorAll('.account-label')].slice(0, 4).map((x) => x.innerText.replace(/\s+/g, ' ')),
  }));
  await visit('reports/financial-statements/trial-balance?from=1999-01-01', 'A16-2-balanza', (el) => ({
    h1: el.querySelector('h1')?.innerText, ok: !!el.querySelector('.balance-check--ok'), empty: el.querySelector('.report-state')?.innerText,
  }));
  await visit('accounting/periods', 'M13-1-periodos', (el) => ({
    buttons: [...el.querySelectorAll('.action-button')].map((b) => b.innerText.trim()),
    hints: [...el.querySelectorAll('.period-hint')].slice(0, 3).map((h) => h.innerText),
    badges: [...new Set([...el.querySelectorAll('vx-badge')].map((b) => b.innerText.trim()))],
  }));
  await visit('accounting/chart-of-accounts', 'M19-1-plan-cuentas', (el) => ({
    first: [...el.querySelectorAll('.account-info')].slice(0, 2).map((a) => a.innerText.replace(/\s+/g, ' ')),
    deletes: el.querySelectorAll('.icon-button.delete').length, rows: el.querySelectorAll('tbody tr').length,
    balanceHeader: [...el.querySelectorAll('th')].map((t) => t.innerText.trim()).filter(Boolean),
  }));
  await visit('accounting/daily-journal', 'M21-1-libro-diario', (el) => ({
    filters: !!el.querySelector('.journal-filters'), search: !!el.querySelector('.ls__search-input'), rows: el.querySelectorAll('tbody tr.journal-row').length,
  }));
  const panel = page.locator('.dv-groupview.dv-active-group .dv-content-container').first();
  await panel.locator('.journal-filter select').selectOption('Draft'); await page.waitForTimeout(2500);
  console.log('diario filtrado por borrador →', await panel.locator('tbody tr.journal-row').count(), await panel.locator('.journal-empty').innerText().catch(() => ''));
  await page.screenshot({ path: path.join(OUT, 'M21-2-libro-diario-filtrado.png') });
  await browser.close();
})();
