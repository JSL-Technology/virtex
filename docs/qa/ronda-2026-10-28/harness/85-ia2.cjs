const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  process.env.STEPUP_PASS = 'QA3-Pass-Segura-2026!';
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page);
  const T = async () => (await panelText(page)).replace(/\s+/g, ' ');
  await go(page, 'reports/manager-report'); let n = log.requests.length;
  await p.getByRole('button', { name: /Escribir el informe/ }).click(); await page.waitForTimeout(6000);
  console.log('[informe]', JSON.stringify(netSince(log, n)).slice(0, 400), (await toasts(page)).replace(/\s+/g, ' ').slice(-200), (await T()).slice(0, 500)); await shot(page, 'ia-informe');
  for (const r of ['inventory/predictions', 'accounting/treasury/cash-flow']) { await go(page, r); await page.waitForTimeout(2000); console.log(`[${r}]`, (await T()).slice(0, 700)); await shot(page, `ia2-${r.replace(/\//g, '_')}`); }
  await go(page, 'reports/relationship-map'); n = log.requests.length;
  const inp = p.locator('input[type=text], input[type=search]').first(); await inp.fill('B0100000001'); await inp.press('Enter'); await page.waitForTimeout(2500);
  const opt = page.locator('[role=option]'); if (await opt.count()) { console.log('OPC', JSON.stringify(await opt.allInnerTexts())); await opt.first().click(); await page.waitForTimeout(2500); }
  console.log('[mapa]', JSON.stringify(netSince(log, n)).slice(0, 400), (await T()).slice(0, 1200)); await shot(page, 'ia-mapa');
  // Copiloto: botón de chispa en la barra superior
  n = log.requests.length;
  const top = await page.locator('header button, [class*=topbar] button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') || b.title || b.innerText.trim()));
  console.log('TOPBAR', JSON.stringify(top));
  const cop = page.locator('header button, [class*=topbar] button').filter({ has: page.locator('svg') }).nth(1);
  await page.getByRole('button', { name: /asistente|copiloto|IA|Pregunta/i }).first().click().catch(async () => cop.click());
  await page.waitForTimeout(2000);
  const box = page.locator('textarea').last(); if (await box.count()) { await box.fill('¿Cuánto vendí en octubre de 2026?'); await box.press('Enter'); await page.waitForTimeout(6000); }
  console.log('[copiloto]', JSON.stringify(netSince(log, n)).slice(0, 500), (await page.locator('[role=dialog], aside, [class*=copilot], [class*=assistant]').last().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 700));
  await shot(page, 'ia-copiloto');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
