const { launch, instrument, shot, BASE, ADMIN, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  await page.goto(`${BASE}/es/auth/login`); await page.locator('input[type=password]').waitFor();
  const em = page.locator('input[type=email], input[formcontrolname=email]').first(), pw = page.locator('input[type=password]').first(), sb = page.locator('button[type=submit]').first();
  // Logout
  await page.goto(`${BASE}/es/auth/login`); await page.locator('input[type=password]').waitFor(); await em.fill(ADMIN.email); await pw.fill(ADMIN.password); await sb.click(); await page.waitForURL((u) => !u.pathname.includes('/auth/')); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Dev User/ }).click(); await page.waitForTimeout(800); console.log('[menú usuario]', (await body()).match(/Mi perfil.{0,200}/)?.[0]);
  await page.getByText(/Cerrar sesión/).first().click(); await page.waitForTimeout(3000); console.log('[logout]', page.url().replace(BASE, ''));
  await page.goBack(); await page.waitForTimeout(3000); console.log('[atrás tras logout]', page.url().replace(BASE, ''));
  const st = await page.evaluate(async () => (await fetch('http://localhost:3000/api/v1/invoices?limit=1', { credentials: 'include' })).status); console.log('[api tras logout]', st);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
