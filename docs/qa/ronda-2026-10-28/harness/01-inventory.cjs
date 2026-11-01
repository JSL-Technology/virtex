// Pasada 1: visita cada ruta declarada, enumera sus elementos interactivos y registra
// llamadas de red, errores de consola y estado visual (vacío / error / contenido).
const fs = require('fs');
const path = require('path');
const { launch, instrument, uiLogin, shot, BASE } = require('./lib.cjs');

const ROUTES = fs.readFileSync(path.join(__dirname, 'routes.txt'), 'utf8').trim().split('\n').map((l) => {
  const [mod, full, kind, perm] = l.trim().split(/\s+/);
  return { mod, full, kind, perm };
});
const ORG = process.env.QA_ORG || 'virtex-dev';
const OUT = path.join(__dirname, '..', 'inventory.json');

async function enumerate(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.dv-groupview.dv-active-group .dv-content-container') || document.querySelector('main') || document.body;
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('formcontrolname') || el.getAttribute('name') || el.id || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const items = [];
    root.querySelectorAll('a[href], button, input, select, textarea, [role=button], [role=tab], [role=menuitem], [role=combobox], [role=checkbox], [role=switch], [contenteditable=true]').forEach((el) => {
      if (!visible(el)) return;
      items.push({ tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || el.getAttribute('role') || '', label: label(el), disabled: el.disabled || el.getAttribute('aria-disabled') === 'true', href: el.getAttribute('href') || undefined, required: el.required || undefined });
    });
    const text = (root.innerText || '').trim();
    return { items, textLen: text.length, textHead: text.slice(0, 300).replace(/\s+/g, ' ') };
  });
}

(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  const results = [];
  for (const r of ROUTES) {
    console.log(`>> ${r.full}`);
    if (r.full.includes(':')) { results.push({ ...r, skipped: 'ruta con parámetro: se cubre desde su lista' }); continue; }
    const url = `${BASE}/e/${ORG}/${r.full}`;
    log.requests.length = 0; log.console.length = 0; log.pageErrors.length = 0;
    const t0 = Date.now();
    // Navegación interna del SPA: una carga completa congela la app (QA-002).
    await page.evaluate((u) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }, `/e/${ORG}/${r.full}`);
    await page.waitForTimeout(1200);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const inv = await Promise.race([enumerate(page), new Promise((r) => setTimeout(() => r({ error: 'EVAL TIMEOUT: el hilo principal no responde' }), 15000))]).catch((e) => ({ error: String(e) }));
    const name = `inv-${r.mod}-${r.full.replace(/[\/:]/g, '_')}`;
    const img = await shot(page, name);
    const bad = log.requests.filter((x) => x.status === 'FAILED' || x.status >= 400);
    results.push({ ...r, url, finalUrl: page.url().replace(BASE, ''), ms: Date.now() - t0, img, api: log.requests.map((x) => `${x.method} ${x.url} ${x.status}`), apiErrors: bad, console: [...log.console], pageErrors: [...log.pageErrors], ...inv });
    console.log(`${r.mod} ${r.full} -> ${page.url().replace(BASE, '')} items=${inv.items?.length} text=${inv.textLen} apiErr=${bad.length} cons=${log.console.length} pe=${log.pageErrors.length}`);
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
