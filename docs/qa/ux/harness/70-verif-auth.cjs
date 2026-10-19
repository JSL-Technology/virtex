// Verificación (fix): login, páginas legales, selector de país, fondo — C-06, C-08, A-13, M-14, M-23.
const { launch, BASE } = require('./lib.cjs');
const path = require('path');
const FIX = path.resolve(__dirname, '..', 'evidence', 'fix');
const shot = (page, name, full = false) => page.screenshot({ path: path.join(FIX, `${name}.png`), fullPage: full }).catch((e) => console.log('shot fail', name, e.message));
const wait = (p, ms = 2500) => p.waitForTimeout(ms);

(async () => {
  // ── M-14: login claro y oscuro, placeholder, etiquetas, título de recuperar ──
  for (const [scheme, lang, loc] of [['light', 'es', 'es-ES'], ['dark', 'en', 'en-US'], ['light', 'pt', 'pt-BR']]) {
    const { browser, context } = await launch({ colorScheme: scheme, locale: loc });
    const page = await context.newPage();
    await page.goto(`${BASE}/${lang}/auth/login`, { waitUntil: 'load' }); await wait(page);
    const ph = await page.locator('input[type=password]').getAttribute('placeholder');
    const labels = await page.locator('.secondary-auth button').allInnerTexts();
    const submit = await page.locator('button[type=submit]').innerText();
    console.log(`M-14 ${lang}/${scheme}: password placeholder=${JSON.stringify(ph)} | providers=${JSON.stringify(labels.map((t) => t.trim()))} | submit=${JSON.stringify(submit.trim())} | title=${await page.title()}`);
    await shot(page, `M14-1-login-${lang}-${scheme}`);
    await page.goto(`${BASE}/${lang}/auth/forgot-password`, { waitUntil: 'load' }); await wait(page);
    console.log(`M-14 forgot-password title (${lang}):`, await page.title());
    await browser.close();
  }

  // ── C-08: páginas legales ──
  {
    const { browser, context } = await launch({ locale: 'en-US' });
    const page = await context.newPage();
    for (const p of ['/terms', '/privacy', '/security', '/contact']) {
      await page.goto(BASE + p, { waitUntil: 'load' }); await wait(page);
      console.log('C-08', p, '->', page.url().replace(BASE, ''), '|', await page.title(), '|', (await page.locator('h1').first().innerText().catch(() => '(sin h1)')));
    }
    for (const [lang, doc] of [['es', 'terms'], ['en', 'privacy'], ['pt', 'security'], ['es', 'contact'], ['en', 'contact']]) {
      await page.goto(`${BASE}/${lang}/${doc}`, { waitUntil: 'load' }); await wait(page);
      const meta = await page.locator('.legal-meta').innerText().catch(() => '');
      console.log(`C-08 /${lang}/${doc}: h1=${await page.locator('h1').innerText()} | ${meta.replace(/\s+/g, ' ')} | sections=${await page.locator('.legal-section').count()}`);
      await shot(page, `C08-${lang}-${doc}`, true);
    }
    // Enlaces del pie y de la casilla
    await page.goto(`${BASE}/es/auth/login`, { waitUntil: 'load' }); await wait(page);
    console.log('C-08 footer links:', await page.locator('.footer-nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href'))));
    await page.locator('.footer-nav a').first().click(); await wait(page);
    console.log('C-08 footer Terms click ->', page.url().replace(BASE, ''));
    // Contact: mailto
    await page.goto(`${BASE}/en/contact`, { waitUntil: 'load' }); await wait(page);
    console.log('C-08 contact mailto:', await page.locator('.contact-email a').getAttribute('href'));
    await browser.close();
  }

  // ── C-06: locales no reconocidos ya no llevan a /do/ ──
  for (const loc of ['en-GB', 'pt-PT', 'fr-FR', 'es-MX', 'en-US']) {
    const { browser, context } = await launch({ locale: loc });
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'load' }); await wait(page);
    const href = await page.locator('a[href*="register"]').first().getAttribute('href').catch(() => 'n/a');
    await page.locator('a[href*="register"]').first().click().catch(() => {}); await wait(page, 3500);
    console.log('C-06', loc.padEnd(6), '| Sign up href =', href, '| after click =', page.url().replace(BASE, ''), '| h1 =', await page.locator('h1').first().innerText().catch(() => ''));
    if (loc === 'en-GB') await shot(page, 'C06-1-picker-en-GB', true);
    if (loc === 'es-MX') {
      await page.locator('button.country', { hasText: 'México' }).first().click(); await wait(page, 3500);
      console.log('C-06 es-MX choose México ->', page.url().replace(BASE, ''));
    }
    await browser.close();
  }

  // ── A-13: país no soportado, fallo de carga con reintento, avísame ──
  {
    const { browser, context } = await launch({ locale: 'es-ES' });
    const page = await context.newPage();
    await page.goto(`${BASE}/es/es/auth/register`, { waitUntil: 'load' }); await wait(page, 3500);
    console.log('A-13 /es/es/auth/register ->', page.url().replace(BASE, ''), '|', (await page.locator('.notice-alert').first().innerText().catch(() => '')).trim());
    await shot(page, 'A13-1-pais-no-soportado', true);
    await page.locator('input[name=waitlistEmail]').fill(`qa.waitlist.${Date.now()}@example.com`);
    await page.locator('.waitlist-form button[type=submit]').click(); await wait(page);
    console.log('A-13 waitlist:', (await page.locator('.waitlist').innerText()).replace(/\s+/g, ' ').slice(0, 200));
    await shot(page, 'A13-2-avisame-ok', true);

    // La lista de países falla: mensaje + reintento, nunca login
    let fail = true;
    await page.route('**/localization/countries', (r) => (fail ? r.abort() : r.continue()));
    await page.route('**/localization/config/**', (r) => (fail ? r.abort() : r.continue()));
    const page2 = page;
    await page2.goto(`${BASE}/es/mx/auth/register`, { waitUntil: 'load' }); await wait(page2, 3500);
    console.log('A-13 config fails ->', page2.url().replace(BASE, ''), '| alert:', (await page2.locator('[role=alert]').first().innerText().catch(() => '')).trim());
    await shot(page2, 'A13-3-fallo-carga', true);
    fail = false;
    await page2.locator('button', { hasText: /Reintentar/ }).first().click(); await wait(page2, 3000);
    console.log('A-13 after retry, countries listed:', await page2.locator('button.country').count());
    await shot(page2, 'A13-4-reintento-ok', true);
    await browser.close();
  }

  // ── M-23: pantalla alta, fondo hasta abajo (claro y oscuro) ──
  for (const scheme of ['light', 'dark']) {
    const { browser, context } = await launch({ locale: 'en-US', colorScheme: scheme, viewport: { width: 1440, height: 1300 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/en/us/auth/register`, { waitUntil: 'load' }); await wait(page, 3500);
    await page.locator('button', { hasText: /^\s*Next\s*$/ }).last().click(); await wait(page, 800);
    const canvas = await page.evaluate(() => { const c = document.querySelector('.auth-canvas'); const r = c.getBoundingClientRect(); return { canvasH: Math.round(r.height), docH: document.documentElement.scrollHeight, bg: getComputedStyle(c).backgroundColor }; });
    console.log(`M-23 ${scheme}:`, JSON.stringify(canvas));
    await shot(page, `M23-1-registro-alto-${scheme}`, true);
    await browser.close();
  }
})();
