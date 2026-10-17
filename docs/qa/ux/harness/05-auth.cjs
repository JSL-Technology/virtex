const { launch, shot } = require('./lib.cjs');
(async () => {
  const combos = [['es','light',1440],['en','dark',1440],['pt','light',1440],['es','dark',390]];
  for (const [lang, theme, w] of combos) {
    const mobile = w < 800;
    const { browser, context } = await launch({ colorScheme: theme, viewport: { width: w, height: mobile ? 844 : 900 }, isMobile: mobile, locale: lang });
    await context.addInitScript((t) => { try { localStorage.setItem('vx-theme-mode', t); } catch {} }, theme);
    const page = await context.newPage();
    const tag = `A-${lang}-${theme}-${w}`;
    for (const p of ['auth/login', 'auth/register', 'auth/forgot-password']) {
      await page.goto(`http://localhost:4200/${lang}/${p}`, { waitUntil: 'load' }); await page.waitForTimeout(3500);
      console.log(tag, p, page.url(), (await page.title()));
      await shot(page, `auth/${tag}-${p.split('/')[1]}`, true);
    }
    await browser.close();
  }
})();
