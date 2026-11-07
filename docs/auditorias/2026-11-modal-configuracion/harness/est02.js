// EST-02: cada página muestra carga y error con reintento. Se corta la red de los datos de la página
// (GET a la API, salvo la sesión) y se comprueba que la página lo dice y ofrece reintentar; después se
// restablece la red, se pulsa «Reintentar» y se comprueba que el contenido llega.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'salida');
const BASE = 'http://localhost:4200';
const STATE = path.join(__dirname, 'state.json');
const SECTIONS = ['my-profile', 'account-security', 'preferences', 'organizations', 'profile', 'regional-format', 'branding', 'subsidiaries', 'branches', 'smtp', 'billing', 'users', 'roles', 'security', 'audit-trail', 'sso', 'integrations', 'ai', 'extensions', 'default-accounts', 'accounting-policies', 'fiscal', 'withholding-regimes', 'sequences', 'approvals'];
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const list = ONLY ? SECTIONS.filter((s) => ONLY.split(',').includes(s)) : SECTIONS;
const shot = (name) => { const p = path.join(ROOT, 'shots', 'est02', name); fs.mkdirSync(path.dirname(p), { recursive: true }); return p; };
// Solo la sesión y el andamiaje de la aplicación siguen con red; los datos de cada página, no.
const KEEP = /\/auth\/session(\?|$)|\/auth\/refresh|\/auth\/csrf|\/i18n\/|\/assets\/|\/socket|\/notifications|\/organizations\/mine|\/organizations\/current|\/tenancy|\/me(\?|$)/;

const probe = () => {
  const section = document.querySelector('.sm-section');
  const err = section?.querySelector('vx-error-state, .ls__state--error, [role="alert"]');
  const retry = section?.querySelector('vx-error-state button, .ls__retry, [role="alert"] button');
  return {
    error: !!err,
    errorText: err ? err.innerText.replace(/\s+/g, ' ').trim().slice(0, 160) : null,
    retry: !!retry,
    spinner: !!section?.querySelector('vx-spinner, .ls__skeleton'),
    shellState: document.querySelector('.sm-state')?.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) || null,
  };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-DO', storageState: STATE });
  const page = await ctx.newPage();
  const prevFile = path.join(ROOT, 'results', 'est02.json');
  const R = ONLY && fs.existsSync(prevFile) ? JSON.parse(fs.readFileSync(prevFile, 'utf8')) : {};
  let n = 0;
  for (const id of list) {
    n++;
    await page.goto(BASE + '/e/virtex-dev/overview', { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(800);
    // Abrir la modal en otra página (con red) para que el armazón esté cargado.
    await page.evaluate(() => { location.hash = '#settings/organizations'; });
    await page.waitForSelector('.sm-panel', { timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const aborted = [];
    const handler = (route) => {
      const req = route.request();
      if (req.method() === 'GET' && req.url().includes('/api/') && !KEEP.test(req.url())) {
        aborted.push(req.url().replace(/^https?:\/\/[^/]+/, ''));
        return route.abort('failed');
      }
      return route.continue();
    };
    await page.route('**/*', handler);
    await page.evaluate((s) => { location.hash = '#settings/' + s; }, id);
    await page.waitForTimeout(3500);
    const down = await page.evaluate(probe);
    const file = `${String(n).padStart(2, '0')}-${id}-sin-red.png`;
    await page.screenshot({ path: shot(file) });
    await page.unroute('**/*', handler);
    let recovered = null;
    if (down.retry) {
      // Cada error de la página tiene su reintento; se pulsan todos, como haría una persona.
      for (let i = 0; i < 4; i++) {
        const retry = page.locator('.sm-section vx-error-state button, .sm-section .ls__retry, .sm-section [role="alert"] button').first();
        if (!(await retry.count())) break;
        await retry.click();
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
      recovered = await page.evaluate(probe);
      R[id] = { retries: true };
      await page.screenshot({ path: shot(`${String(n).padStart(2, '0')}-${id}-reintento.png`) });
    }
    R[id] = { aborted: [...new Set(aborted)].slice(0, 8), abortedCount: aborted.length, down, recovered, shot: file };
    const verdict = !aborted.length ? 'N/A (sin datos del servidor)' : down.error && down.retry && recovered && !recovered.error ? 'CUMPLE' : down.error && down.retry ? 'error+reintento (no recupera)' : 'NO CUMPLE';
    R[id].verdict = verdict;
    console.log(`${id}: aborted=${aborted.length} error=${down.error} retry=${down.retry} spinner=${down.spinner} recovered=${recovered ? !recovered.error : '-'} → ${verdict}`);
  }
  fs.writeFileSync(path.join(ROOT, 'results', 'est02.json'), JSON.stringify(R, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
