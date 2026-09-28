// Pasada 2: en cada página, toca CADA elemento interactivo del panel activo y registra qué pasó
// (navegación, pestaña nueva, diálogo, llamadas de red, errores, o "sin efecto").
// Las acciones destructivas se omiten aquí y se prueban a mano sobre datos QA- (se registran como tales).
const fs = require('fs');
const path = require('path');
const { launch, instrument, uiLogin, shot, BASE } = require('./lib.cjs');

const ORG = process.env.QA_ORG || 'virtex-dev';
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const OUT = path.join(__dirname, '..', process.env.OUT || 'clicks.json');
const DESTRUCTIVE = /elimin|borrar|anular|delete|remove|quitar|revert|cerrar (el )?per[ií]odo|cierre|procesar|aprobar|rechaz|void|contabiliz|publicar|post\b|cerrar sesi|logout|salir|desactiv|revoc|pagar|cobrar|emitir|enviar/i;
const ROUTES = fs.readFileSync(path.join(__dirname, 'routes.txt'), 'utf8').trim().split('\n').map((l) => { const [mod, full, kind, perm] = l.trim().split(/\s+/); return { mod, full, kind, perm }; })
  .filter((r) => !r.full.includes(':') && (!ONLY || ONLY.test(r.full)));

const spaNav = (page, url) => page.evaluate((u) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }, url);

async function tag(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.dv-groupview.dv-active-group .dv-content-container');
    if (!root) return [];
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('formcontrolname') || el.getAttribute('name') || el.id || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const out = [];
    let i = 0;
    const seen = new Set();
    root.querySelectorAll('a[href], button, input, select, textarea, [role=button], [role=tab], [role=menuitem], [role=combobox], [role=checkbox], [role=switch], thead th, tbody tr:first-child, [tabindex]:not([tabindex="-1"]), [class*=card][class*=click], summary').forEach((el) => {
      if (!visible(el) || seen.has(el)) return; seen.add(el);
      if (el.tagName === 'TH' && !(el.innerText || '').trim()) return;
      el.setAttribute('data-qa-i', String(i));
      out.push({ i, tag: el.tagName === 'TR' ? 'fila' : el.tagName.toLowerCase(), type: (el.getAttribute('type') || el.getAttribute('role') || '').toLowerCase(), label: label(el), disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true' });
      i++;
    });
    return out;
  });
}

async function state(page) {
  return page.evaluate(() => ({
    url: location.pathname + location.search,
    tabs: document.querySelectorAll('.dv-tab').length,
    dialogs: document.querySelectorAll('[role=dialog], dialog[open], .cdk-overlay-pane, [class*=modal]:not([class*=modal-outlet])').length,
    menus: document.querySelectorAll('[role=menu], [role=listbox], .cdk-overlay-pane').length,
    html: (document.querySelector('.dv-groupview.dv-active-group .dv-content-container') || document.body).innerHTML.length,
    toast: [...document.querySelectorAll('[role=alert], [class*=toast], [class*=snack]')].map((e) => e.innerText.trim()).filter(Boolean).join(' | ').slice(0, 200),
  }));
}

async function closeExtraTabs(page, keep) {
  // Cierra pestañas por el aspa hasta volver al número original.
  for (let k = 0; k < 6; k++) {
    const n = await page.locator('.dv-tab').count();
    if (n <= keep) break;
    const tabs = page.locator('.dv-tab');
    const last = tabs.nth(n - 1);
    await last.hover().catch(() => {});
    const x = last.locator('[class*=close], button').last();
    await x.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
    // Diálogo de "cambios sin guardar": descartar.
    const discard = page.getByRole('button', { name: /descartar|no guardar|cerrar sin|discard/i });
    if (await discard.count()) await discard.first().click().catch(() => {});
  }
}

(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await uiLogin(page);
  const results = fs.existsSync(OUT) && process.env.RESUME ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  for (const r of ROUTES) {
    if (results[r.full]) continue;
    const url = `/e/${ORG}/${r.full}`;
    const pageRes = { mod: r.mod, route: r.full, elements: [] };
    await spaNav(page, url); await page.waitForTimeout(1500);
    const baseTabs = await page.locator('.dv-tab').count();
    let elems = await tag(page);
    pageRes.total = elems.length;
    console.log(`== ${r.full} (${elems.length} elementos)`);
    for (let idx = 0; idx < elems.length; idx++) {
      const e = elems[idx];
      const rec = { ...e };
      if (e.disabled) { rec.status = 'no probado'; rec.result = 'deshabilitado en este estado'; pageRes.elements.push(rec); continue; }
      if (DESTRUCTIVE.test(e.label)) { rec.status = 'no probado (auto)'; rec.result = 'acción destructiva/irreversible: se prueba manualmente sobre datos QA-'; pageRes.elements.push(rec); continue; }
      // Volver a un estado limpio de la página
      if (page.url().replace(BASE, '') !== url) { await spaNav(page, url); await page.waitForTimeout(900); }
      await page.keyboard.press('Escape').catch(() => {});
      const fresh = await tag(page);
      const target = fresh.find((f) => f.label === e.label && f.tag === e.tag && f.type === e.type) || fresh[e.i];
      if (!target) { rec.status = 'no probado'; rec.result = 'el elemento no reaparece tras restaurar la página'; pageRes.elements.push(rec); continue; }
      const loc = page.locator(`[data-qa-i="${target.i}"]`);
      const before = await state(page);
      log.requests.length = 0; log.console.length = 0; log.pageErrors.length = 0;
      try {
        if (['input', 'textarea'].includes(e.tag) && !['checkbox', 'radio', 'submit', 'button', 'file'].includes(e.type)) {
          const v = e.type === 'number' ? '12345' : e.type === 'date' ? '2026-09-15' : e.type === 'email' ? 'qa@example.com' : 'QA-áéí ñ <b>&"\'';
          await loc.fill(v, { timeout: 3000 });
          await page.waitForTimeout(900);
          const got = await loc.inputValue().catch(() => '?');
          rec.action = `escribir "${v}"`; rec.value = got;
        } else if (e.tag === 'select') {
          const opts = await loc.locator('option').evaluateAll((os) => os.map((o) => o.value));
          for (const o of opts) await loc.selectOption(o).catch(() => {});
          rec.action = `seleccionar ${opts.length} opciones`; await page.waitForTimeout(700);
        } else if (e.type === 'file') {
          rec.action = 'selector de archivo'; rec.status = 'pendiente manual'; rec.result = 'requiere archivo: se prueba en flujo específico'; pageRes.elements.push(rec); continue;
        } else {
          await loc.click({ timeout: 3000 });
          rec.action = 'clic';
          await page.waitForTimeout(1300);
        }
      } catch (err) { rec.action = rec.action || 'clic'; rec.status = 'con falla'; rec.result = `no interactuable: ${String(err.message).split('\n')[0].slice(0, 120)}`; pageRes.elements.push(rec); continue; }
      const after = await state(page);
      const effects = [];
      if (after.url !== before.url) effects.push(`navega a ${after.url}`);
      if (after.tabs !== before.tabs) effects.push(`pestañas ${before.tabs}→${after.tabs}`);
      if (after.dialogs > before.dialogs) effects.push('abre diálogo/panel');
      if (after.menus > before.menus) effects.push('abre menú/lista');
      if (Math.abs(after.html - before.html) > 30) effects.push('cambia contenido');
      if (after.toast && after.toast !== before.toast) effects.push(`aviso: ${after.toast}`);
      const api = log.requests.filter((x) => !/me\/(workspace|jobs)/.test(x.url)).map((x) => `${x.method} ${x.url} ${x.status}`);
      if (api.length) effects.push(`red: ${api.slice(0, 4).join(', ')}`);
      const bad = log.requests.filter((x) => (x.status === 'FAILED' || x.status >= 400) && !/localhost:4200\/api\/v1\/me\/(workspace|jobs)/.test(x.url));
      rec.effects = effects; rec.console = [...log.console, ...log.pageErrors].slice(0, 3); rec.apiErrors = bad;
      if (bad.length || log.pageErrors.length) { rec.status = 'con falla'; rec.result = `error: ${bad.map((b) => `${b.method} ${b.url} ${b.status} ${b.body}`).join(' ; ')} ${log.pageErrors.join(' ; ')}`.slice(0, 400); }
      else if (!effects.length && e.tag === 'th') { rec.status = 'ok'; rec.result = 'encabezado no ordenable (sin efecto)'; rec.noSort = true; }
      else if (!effects.length && rec.action === 'clic') { rec.status = 'con falla'; rec.result = 'sin efecto visible ni llamada de red'; }
      else { rec.status = 'ok'; rec.result = effects.join(' · ') || `valor queda "${rec.value}"`; }
      if (rec.status === 'con falla') await shot(page, `clk-${r.full.replace(/\//g, '_')}-${idx}`);
      pageRes.elements.push(rec);
      // Restaurar: cerrar diálogos y pestañas nuevas
      await page.keyboard.press('Escape').catch(() => {});
      await closeExtraTabs(page, baseTabs);
    }
    pageRes.tested = pageRes.elements.filter((x) => x.status === 'ok' || x.status === 'con falla').length;
    results[r.full] = pageRes;
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
    console.log(`   probados ${pageRes.tested}/${pageRes.total}; fallas ${pageRes.elements.filter((x) => x.status === 'con falla').length}`);
    await closeExtraTabs(page, 1);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
