// Sesión y seguridad: login inválido (mensaje), fuerza bruta, XSS almacenado en nombre de producto,
// cerrar pestaña con cambios, atrás del navegador a mitad de formulario, sesión expirada (cookies borradas), logout.
const { launch, instrument, uiLogin, shot, go, fill, click, panel, panelText, netSince, errorsShown, BASE } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  let alerts = 0;
  page.on('dialog', (d) => { alerts++; console.log('DIALOG', d.type(), d.message()); d.dismiss(); });
  // 1. Login inválido y fuerza bruta (usuario inexistente para no bloquear cuentas QA)
  await page.goto(`${BASE}/es/auth/login`, { waitUntil: 'load' }); await page.locator('input[type=password]').waitFor();
  for (let i = 1; i <= 7; i++) {
    const n = log.requests.length;
    await page.locator('input[type=email], input[formcontrolname=email]').first().fill(i === 1 ? 'dev@virtex.local' : 'noexiste-qa@example.com');
    await page.locator('input[type=password]').fill('mala-clave-' + i);
    await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(1500);
    const msg = (await page.locator('[role=alert], [class*=error], .alert').allInnerTexts()).filter(Boolean).join(' / ').slice(0, 160);
    console.log(`[login-${i}] ${netSince(log, n).map((x) => x.slice(0, 120)).join(' ; ')} | msg=${msg}`);
    if (i === 1 || i === 7) await shot(page, `f-sec-login-${i}`);
  }
  // Reset del contador para el resto
  require('child_process').execSync(`${__dirname}/reset-throttle.sh`);
  await uiLogin(page);
  const p = panel(page);
  // 2. XSS almacenado en nombre de producto
  await go(page, 'inventory/products/new');
  await fill(page, 'Nombre del Producto', 'QA-XSS <img src=x onerror=alert(1)> "\'');
  await fill(page, 'SKU', 'QA-XSS-1'); await fill(page, 'Precio de Venta', '5');
  let n = log.requests.length; await click(page, 'Guardar producto'); console.log('[xss-crear]', netSince(log, n).join(' ; ').slice(0, 200));
  for (const r of ['inventory/products', 'global-search']) { await go(page, r); if (r === 'global-search') { await p.getByPlaceholder(/Buscar en todo/).fill('QA-XSS'); await page.keyboard.press('Enter'); } await page.waitForTimeout(1500); }
  const imgs = await page.evaluate(() => document.querySelectorAll('img[src="x"]').length);
  console.log('[xss] alerts=', alerts, 'img[src=x] inyectadas=', imgs);
  await shot(page, 'f-sec-xss');
  // 3. Cerrar pestaña con cambios sin guardar
  await go(page, 'contacts/customers/new');
  await fill(page, 'Nombre del cliente', 'QA-Sucio sin guardar');
  const tab = page.locator('.dv-tab').last(); await tab.hover(); await tab.locator('[class*=close]').first().click(); await page.waitForTimeout(1000);
  console.log('[tab-sucia]', (await page.locator('[role=dialog]').allInnerTexts()).join(' / ').replace(/\n+/g, ' ').slice(0, 300));
  await shot(page, 'f-sec-tab-sucia');
  await page.keyboard.press('Escape');
  // 4. Atrás del navegador a mitad de formulario
  await go(page, 'inventory/products/new'); await fill(page, 'Nombre del Producto', 'QA-Atras');
  await page.goBack().catch(() => {}); await page.waitForTimeout(1500);
  console.log('[atras] url=', page.url().replace(BASE, ''), '| vivo=', await Promise.race([page.evaluate(() => 'ok'), new Promise((r) => setTimeout(() => r('FROZEN'), 5000))]));
  await shot(page, 'f-sec-atras');
  // 5. Sesión expirada: borrar cookies y luego guardar
  await go(page, 'inventory/categories');
  await context.clearCookies();
  n = log.requests.length;
  await click(page, 'Nueva Categoría').catch(() => {}); const s = page.locator('[role=dialog]').last(); const scope = (await s.count()) ? s : p; await scope.locator('input').first().fill('QA-Tras expirar'); await scope.getByRole('button', { name: /Guardar/ }).last().click().catch(() => {});
  await page.waitForTimeout(3000);
  console.log('[expirada]', netSince(log, n).map((x) => x.slice(0, 110)).join(' ; '), '| url=', page.url().replace(BASE, ''));
  await shot(page, 'f-sec-expirada');
  // 6. Logout
  await uiLogin(page).catch((e) => console.log('relogin', e.message.split('\n')[0]));
  await page.locator('header').getByText(/Dev/).first().click(); await page.waitForTimeout(600);
  n = log.requests.length; await page.getByText('Cerrar Sesión').last().click(); await page.waitForTimeout(2500);
  console.log('[logout]', netSince(log, n).join(' ; ').slice(0, 300), '| url=', page.url().replace(BASE, ''));
  // tras logout, ¿se puede volver con "atrás"?
  await page.goBack().catch(() => {}); await page.waitForTimeout(2000);
  console.log('[logout-atras] url=', page.url().replace(BASE, ''), (await page.locator('body').innerText()).slice(0, 120).replace(/\n+/g, ' '));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
