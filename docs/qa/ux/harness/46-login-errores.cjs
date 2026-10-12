const { launch, shot, instrument } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await page.goto('http://localhost:4200/es/auth/login', { waitUntil: 'load' }); await page.waitForTimeout(2500);
  await page.locator('button[type=submit]').click(); await page.waitForTimeout(800);
  await shot(page, 'A-err-1-vacio');
  console.log('VACIO:', (await page.locator('form').innerText()).match(/.*(obligatori|requerid|válid).*/gi));
  await page.locator('input[type=email]').fill('dev@virtex.local'); await page.locator('input[type=password]').fill('incorrecta-123');
  await page.locator('button[type=submit]').click(); await page.waitForTimeout(2500);
  await shot(page, 'A-err-2-incorrecta');
  console.log('INCORRECTA:', await page.locator('[role=alert], .toast, .error, .alert').allInnerTexts());
  for (let i = 0; i < 5; i++) { await page.locator('button[type=submit]').click(); await page.waitForTimeout(1500); }
  await shot(page, 'A-err-3-repetido');
  console.log('REPETIDO:', await page.locator('[role=alert], .toast, .error, .alert').allInnerTexts());
  console.log(log.req.filter(r => /login/.test(r)).slice(-3).join('\n'));
  // olvidé contraseña
  await page.goto('http://localhost:4200/es/auth/forgot-password', { waitUntil: 'load' }); await page.waitForTimeout(2000);
  await page.locator('input[type=email]').fill('noexiste@example.com'); await page.locator('button[type=submit]').click(); await page.waitForTimeout(2500);
  await shot(page, 'A-err-4-olvide');
  console.log('OLVIDE:', (await page.locator('main, form, body').first().innerText()).slice(0, 400).replace(/\n+/g, ' | '));
  // enlaces legales
  for (const p of ['/terms', '/privacy', '/security', '/contact']) { await page.goto('http://localhost:4200' + p, { waitUntil: 'load' }); await page.waitForTimeout(2000); console.log(p, '->', page.url().replace('http://localhost:4200', ''), '|', await page.title(), '|', (await page.locator('h1').first().innerText().catch(() => '(sin h1)')).slice(0, 60)); }
  await shot(page, 'A-legal-contacto');
  await browser.close();
})();
