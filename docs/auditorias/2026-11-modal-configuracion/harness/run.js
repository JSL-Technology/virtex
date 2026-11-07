// Arnés de evaluación de la modal de Configuración.
// Uso: VX_PASS=... node run.js <fase> [--dsf=1]
// Fases: login | base | dark | phone | laptop | focus | dirty | search | density
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'salida');
const BASE = 'http://localhost:4200';
const AXE = fs.readFileSync(path.join(__dirname, '../../../../node_modules/axe-core/axe.min.js'), 'utf8');
const STATE = path.join(__dirname, 'state.json');
const phase = process.argv[2] || 'base';
const DSF = Number((process.argv.find((a) => a.startsWith('--dsf=')) || '--dsf=1').split('=')[1]);
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];

const SECTIONS = [
  'my-profile', 'account-security', 'preferences', 'organizations',
  'profile', 'regional-format', 'branding', 'subsidiaries', 'branches', 'smtp', 'billing',
  'users', 'roles', 'security', 'audit-trail', 'sso', 'integrations', 'ai', 'extensions',
  'default-accounts', 'accounting-policies', 'fiscal', 'withholding-regimes', 'sequences', 'approvals',
];
const sections = ONLY ? SECTIONS.filter((s) => ONLY.split(',').includes(s)) : SECTIONS;

const out = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); return p; };
const shot = (dir, name) => out(path.join(ROOT, 'shots', dir, name));
const save = (name, data) => fs.writeFileSync(out(path.join(ROOT, 'results', name)), JSON.stringify(data, null, 2));

async function login(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-DO' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/es/auth/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Correo electrónico').fill('dev@virtex.local');
  await page.locator('input[type="password"]').fill(process.env.VX_PASS);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForURL(/\/e\/virtex-dev\//, { timeout: 30000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await ctx.storageState({ path: STATE });
  await ctx.close();
}

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    deviceScaleFactor: opts.dsf || DSF,
    colorScheme: opts.colorScheme || 'light',
    locale: 'es-DO',
    storageState: STATE,
    hasTouch: !!opts.touch,
    isMobile: !!opts.mobile,
  });
  const page = await ctx.newPage();
  page._log = { console: [], http: [], native: [] };
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) page._log.console.push(`[${m.type()}] ${m.text()}`.slice(0, 300)); });
  page.on('pageerror', (e) => page._log.console.push(`[pageerror] ${e.message}`.slice(0, 300)));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) page._log.http.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
  await page.addInitScript(() => {
    for (const fn of ['alert', 'confirm', 'prompt']) {
      const orig = window[fn];
      window[fn] = (...a) => { (window.__native = window.__native || []).push(fn + ': ' + String(a[0]).slice(0, 120)); return fn === 'confirm' ? false : orig?.call(window, ...a); };
    }
  });
  await page.goto(BASE + '/e/virtex-dev/overview', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  if (opts.density) await page.evaluate((d) => document.documentElement.setAttribute('data-density', d), opts.density);
  return page;
}

async function openSection(page, id) {
  page._log.console.length = 0; page._log.http.length = 0;
  await page.evaluate((s) => { location.hash = '#settings/' + s; }, id);
  await page.waitForSelector('.sm-panel', { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('.sm-loading'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.sm-section .ss__state[role="status"]'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.sm-section vx-spinner, .sm-section .ls__skeleton'), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.evaluate(() => { const c = document.querySelector('.sm-content'); if (c) c.scrollTop = 0; });
}

// Mediciones dentro de la página (se ejecuta en el navegador).
function collect() {
  const panel = document.querySelector('.sm-panel');
  const content = document.querySelector('.sm-content');
  const section = document.querySelector('.sm-section');
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0; };
  const txt = (el) => (el ? (el.innerText || el.textContent || '') : '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const st = (el, props) => { const cs = getComputedStyle(el); const o = {}; for (const p of props) o[p] = cs.getPropertyValue(p); return o; };
  const cRect = content.getBoundingClientRect();
  const yIn = (el) => Math.round(el.getBoundingClientRect().top - cRect.top + content.scrollTop);
  const rootStyle = getComputedStyle(document.documentElement);
  const hexToRgb = (h) => { h = h.trim(); if (!h.startsWith('#')) return h; const n = h.length === 4 ? h.slice(1).split('').map((c) => c + c).join('') : h.slice(1, 7); return `rgb(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)})`; };
  const accent = hexToRgb(rootStyle.getPropertyValue('--accent-solid'));
  const titleEl = document.querySelector('.sm-page__title');
  const header = {
    crumb: txt(document.querySelector('.sm-page__crumb')),
    title: txt(titleEl),
    titleStyle: titleEl ? st(titleEl, ['font-size', 'font-weight']) : null,
    description: txt(document.querySelector('.sm-page__description')),
    scope: txt(document.querySelector('.sm-scope')),
    autosave: !!document.querySelector('.sm-autosave'),
    readonly: !!document.querySelector('.sm-readonly'),
    headerActions: [...document.querySelectorAll('.sm-page__actions button, .sm-page__actions a')].filter(vis).map((b) => txt(b)),
  };
  const all = section ? [...section.querySelectorAll('*')].filter(vis) : [];
  // Ancho efectivo del contenido.
  let left = Infinity, right = -Infinity;
  for (const el of all) { const r = el.getBoundingClientRect(); if (r.width < 2000) { left = Math.min(left, r.left); right = Math.max(right, r.right); } }
  const sectionRect = section ? section.getBoundingClientRect() : { width: 0, left: 0 };
  const maxWidths = [...new Set(all.slice(0, 400).map((el) => getComputedStyle(el).maxWidth).filter((v) => v !== 'none' && !v.endsWith('%')))].slice(0, 8);
  // Encabezados y títulos de grupo.
  const headings = all.filter((el) => /^(H[1-6]|LEGEND)$/.test(el.tagName)).map((el) => ({ tag: el.tagName.toLowerCase(), text: txt(el).slice(0, 60), ...st(el, ['font-size', 'font-weight', 'text-transform', 'color']) }));
  const upper = all.filter((el) => getComputedStyle(el).textTransform === 'uppercase' && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((el) => ({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 50), text: txt(el).slice(0, 50), fs: getComputedStyle(el).fontSize }));
  // Contenedores tipo tarjeta.
  const isCard = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); if (r.height < 48 || r.width < 140) return false; const b = ['top', 'right', 'bottom', 'left'].every((s) => parseFloat(cs.getPropertyValue(`border-${s}-width`)) >= 1 && cs.getPropertyValue(`border-${s}-style`) !== 'none'); const rad = parseFloat(cs.borderTopLeftRadius) >= 4; const isField = /^(INPUT|SELECT|TEXTAREA|BUTTON|A|TABLE|THEAD|TBODY|TR|TD|TH|LABEL)$/.test(el.tagName); return b && rad && !isField; };
  const cards = all.filter(isCard);
  const cardInfo = cards.map((el) => { let d = 0, p = el.parentElement; while (p && p !== section) { if (cards.includes(p)) d++; p = p.parentElement; } const cs = getComputedStyle(el); return { depth: d, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow !== 'none', bg: cs.backgroundColor, cls: String(el.className).slice(0, 60), h: Math.round(el.getBoundingClientRect().height) }; });
  // Botones.
  const btnSel = 'button, a.primary-button, a.secondary-button, a.btn, [role="button"], input[type="submit"]';
  const buttons = [...panel.querySelectorAll(btnSel)].filter(vis).filter((b) => content.contains(b)).map((b) => { const cs = getComputedStyle(b); const r = b.getBoundingClientRect(); const primary = /primary/.test(b.className) || cs.backgroundColor === accent; const area = b.closest('.sm-page__actions') ? 'header' : b.closest('.ssb') ? 'savebar' : 'content'; return { text: txt(b).slice(0, 50), cls: String(b.className).slice(0, 60), primary, danger: /danger/.test(b.className), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true', area, y: yIn(b), w: Math.round(r.width), h: Math.round(r.height), title: b.getAttribute('title') || '' }; });
  const fields = [...section?.querySelectorAll('input:not([type=hidden]):not(.sr-only), select, textarea') || []].filter(vis).map((f) => ({ tag: f.tagName.toLowerCase(), type: f.type, w: Math.round(f.getBoundingClientRect().width), h: Math.round(f.getBoundingClientRect().height), disabled: f.disabled, readonly: f.readOnly }));
  // Truncamientos.
  const truncated = all.filter((el) => el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(getComputedStyle(el).overflowX) && txt(el)).map((el) => ({ text: txt(el).slice(0, 80), title: el.getAttribute('title') || el.closest('[title]')?.getAttribute('title') || '' })).slice(0, 15);
  // Claves i18n crudas y formatos.
  const panelText = panel.innerText;
  const rawKeys = [...new Set((panelText.match(/\b[a-z][a-z0-9_]*\.[a-z0-9_]+\.[a-z0-9_.]+\b/g) || []).filter((k) => !/@|www|http|\.(com|local|do|org|net)\b/.test(k)))].slice(0, 15);
  const sectionText = section ? section.innerText : '';
  const dates = [...new Set(sectionText.match(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2} (de )?[a-zé]{3,10}\.? (de )?\d{4}\b/gi) || [])].slice(0, 10);
  const money = [...new Set(sectionText.match(/(RD\$|US\$|DOP|USD|\$)\s?-?\d[\d.,]*/g) || [])].slice(0, 10);
  const empties = all.filter((el) => /empty/i.test(String(el.className)) && el.parentElement && !/empty/i.test(String(el.parentElement.className))).map((el) => ({ cls: String(el.className).slice(0, 60), text: txt(el).slice(0, 100), icon: !!el.querySelector('svg, lucide-icon'), action: !!el.querySelector('button, a') })).slice(0, 6);
  const tables = all.filter((el) => el.tagName === 'TABLE').map((t) => ({ cols: t.querySelectorAll('thead th').length, rows: t.querySelectorAll('tbody tr').length, numericRight: [...t.querySelectorAll('td')].filter((td) => /^-?[\d.,\s]+$|RD\$|US\$/.test(td.innerText.trim()) && td.innerText.trim()).map((td) => getComputedStyle(td).textAlign).slice(0, 6) }));
  return {
    header,
    contentWidth: Math.round(right - left), sectionWidth: Math.round(sectionRect.width), contentOffset: Math.round(left - sectionRect.left), maxWidths,
    screens: Math.round((content.scrollHeight / content.clientHeight) * 10) / 10,
    hOverflow: content.scrollWidth > content.clientWidth + 1,
    headings, upper, cards: cardInfo, buttons, fields, truncated, rawKeys, dates, money, empties, tables,
    primaryVisibleAtRest: buttons.filter((b) => b.primary).length,
    native: window.__native || [],
  };
}

async function axe(page) {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const r = await window.axe.run({ include: [['.sm-panel']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, targets: v.nodes.slice(0, 6).map((n) => n.target.join(' ')), summary: (v.nodes[0]?.failureSummary || '').slice(0, 220) }));
  });
}

async function screenshotsScrolling(page, dir, base, max = 6) {
  const files = [];
  const { sh, ch } = await page.evaluate(() => { const c = document.querySelector('.sm-content'); return { sh: c.scrollHeight, ch: c.clientHeight }; });
  let y = 0, i = 0;
  while (i < max) {
    await page.evaluate((v) => { document.querySelector('.sm-content').scrollTop = v; }, y);
    await page.waitForTimeout(250);
    const f = shot(dir, `${base}-${i}.png`);
    await page.screenshot({ path: f });
    files.push(path.relative(ROOT, f));
    if (y + ch >= sh - 2) break;
    y += Math.round(ch * 0.85); i++;
  }
  await page.evaluate(() => { document.querySelector('.sm-content').scrollTop = 0; });
  return files;
}

async function sweep(browser, dir, opts, { scroll = true, doAxe = true, maxShots = 6 } = {}) {
  const page = await newPage(browser, opts);
  const results = {};
  let n = 0;
  for (const id of sections) {
    n++;
    try {
      await openSection(page, id);
      const m = await page.evaluate(collect);
      if (doAxe) m.axe = await axe(page);
      m.shots = scroll ? await screenshotsScrolling(page, dir, `${String(n).padStart(2, '0')}-${id}`, maxShots) : [];
      if (!scroll) { const f = shot(dir, `${String(n).padStart(2, '0')}-${id}.png`); await page.screenshot({ path: f }); m.shots = [path.relative(ROOT, f)]; }
      m.console = [...page._log.console]; m.http = [...page._log.http];
      results[id] = m;
      console.log(`${id}: screens=${m.screens} primary=${m.primaryVisibleAtRest} cards=${m.cards.length} axe=${(m.axe || []).map((v) => v.id + 'x' + v.count).join(',')} http=${m.http.length}`);
    } catch (e) { results[id] = { error: String(e).slice(0, 300) }; console.log(`${id}: ERROR ${e}`); }
  }
  await page.context().close();
  return results;
}

async function focusPhase(browser) {
  const page = await newPage(browser, {});
  const results = {};
  for (const id of sections) {
    await openSection(page, id);
    await page.focus('#settings-section-title').catch(() => {});
    const seq = [];
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      seq.push(await page.evaluate(() => {
        const el = document.activeElement; const panel = document.querySelector('.sm-panel');
        if (!el || el === document.body) return { tag: 'body', inPanel: false };
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), cy = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        const covered = !!top && !(el === top || el.contains(top) || top.contains(el) || top.closest('label') === el.closest('label'));
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
        return { tag: el.tagName.toLowerCase(), id: el.id, cls: String(el.className).slice(0, 50), name: (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 50), inPanel: !!panel?.contains(el), ring, visibleBox: r.width > 1 && r.height > 1, inViewport: r.bottom > 0 && r.top < innerHeight, covered, w: Math.round(r.width), h: Math.round(r.height) };
      }));
    }
    const uniq = [];
    for (const s of seq) { const k = s.tag + s.id + s.name + s.cls; if (!uniq.find((u) => u.k === k)) uniq.push({ k, ...s }); }
    results[id] = { stops: uniq.length, leftPanel: seq.filter((s) => !s.inPanel).length, noRing: uniq.filter((s) => !s.ring && s.inPanel).map((s) => `${s.tag}#${s.id}.${s.cls} «${s.name}»`), invisibleBox: uniq.filter((s) => !s.visibleBox).map((s) => `${s.tag}#${s.id} «${s.name}»`), covered: uniq.filter((s) => s.covered).map((s) => `${s.tag}#${s.id} «${s.name}»`) };
    console.log(`${id}: stops=${results[id].stops} left=${results[id].leftPanel} noRing=${results[id].noRing.length} invisible=${results[id].invisibleBox.length} covered=${results[id].covered.length}`);
  }
  await page.context().close();
  return results;
}

async function dirtyPhase(browser) {
  const page = await newPage(browser, { dsf: 2 });
  const targets = ONLY ? sections : ['my-profile', 'profile', 'smtp', 'regional-format', 'security', 'sequences', 'branding', 'ai', 'default-accounts', 'preferences'];
  const results = {};
  for (const id of targets) {
    const r = { id };
    await openSection(page, id);
    const handle = await page.$('.sm-section input[type="text"]:not([disabled]):not([readonly]), .sm-section input[type="email"]:not([disabled]):not([readonly]), .sm-section input:not([type]):not([disabled]):not([readonly]), .sm-section textarea:not([disabled]):not([readonly]), .sm-section input[type="number"]:not([disabled]):not([readonly])');
    if (!handle) { r.note = 'sin campo editable de texto'; results[id] = r; console.log(id, r.note); continue; }
    r.field = await handle.evaluate((el) => ({ id: el.id, name: el.getAttribute('formcontrolname') || el.name || '', label: el.labels?.[0]?.innerText?.trim() || el.getAttribute('aria-label') || '', value: el.value }));
    await handle.scrollIntoViewIfNeeded();
    await handle.click();
    await page.keyboard.press('End');
    await page.keyboard.type(r.field.value && /^\d/.test(r.field.value) ? '1' : 'x');
    await page.waitForTimeout(700);
    r.saveBar = await page.evaluate(() => { const b = document.querySelector('.ssb'); return b ? b.innerText.replace(/\s+/g, ' ').trim() : null; });
    r.autosave = await page.evaluate(() => document.querySelector('.sm-autosave')?.innerText.replace(/\s+/g, ' ').trim() || null);
    r.inlineSave = await page.evaluate(() => [...document.querySelectorAll('.sm-section button')].filter((b) => /guardar/i.test(b.innerText) && b.getBoundingClientRect().height > 0).map((b) => ({ text: b.innerText.trim(), disabled: b.disabled })));
    await page.screenshot({ path: shot('dirty', `${id}-1-dirty.png`) });
    // Escape: debe preguntar.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    r.afterEscape = await page.evaluate(() => ({ modalOpen: !!document.querySelector('.sm-panel'), confirm: [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((d) => !d.classList.contains('sm-panel')).map((d) => d.innerText.replace(/\s+/g, ' ').trim().slice(0, 200)) }));
    await page.screenshot({ path: shot('dirty', `${id}-2-escape.png`) });
    if (r.afterEscape.confirm.length) {
      await page.getByRole('button', { name: 'Cancelar', exact: true }).last().click().catch(() => {});
      await page.waitForTimeout(500);
      r.valueKept = await page.evaluate((fid) => (fid ? document.getElementById(fid)?.value : null), r.field.id);
      // Cambiar de sección: debe preguntar.
      const other = id === 'my-profile' ? 'Preferencias' : 'Mi perfil';
      await page.locator('.sm-nav .nav-link', { hasText: other }).first().click();
      await page.waitForTimeout(800);
      r.afterNav = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((d) => !d.classList.contains('sm-panel')).map((d) => d.innerText.replace(/\s+/g, ' ').trim().slice(0, 200)));
      await page.screenshot({ path: shot('dirty', `${id}-3-nav.png`) });
      if (r.afterNav.length) { await page.getByRole('button', { name: 'Descartar', exact: true }).last().click().catch(() => {}); await page.waitForTimeout(800); }
    } else if (!r.afterEscape.modalOpen) {
      r.lostWithoutWarning = true;
    }
    results[id] = r;
    console.log(JSON.stringify(r));
    // Reabrir limpio para la siguiente.
    await page.goto(BASE + '/e/virtex-dev/overview', { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.context().close();
  return results;
}

async function searchPhase(browser) {
  const page = await newPage(browser, { dsf: 2 });
  await openSection(page, 'my-profile');
  const queries = ['contraseña', 'logo', 'NCF', 'moneda', 'impuestos', 'ITBIS', 'correo', 'permisos', 'idioma', 'tema oscuro', 'zona horaria', 'firma', 'xyz123'];
  const results = {};
  for (const q of queries) {
    await page.fill('#settings-search', '');
    await page.fill('#settings-search', q);
    await page.waitForTimeout(400);
    results[q] = await page.evaluate(() => [...document.querySelectorAll('.sm-nav .nav-link__label')].map((e) => e.textContent.trim()).concat([...document.querySelectorAll('.sm-nav__empty')].map((e) => '[vacío] ' + e.textContent.trim())));
    if (['NCF', 'xyz123', 'tema oscuro', 'ITBIS'].includes(q)) await page.screenshot({ path: shot('search', `search-${q.replace(/\s/g, '_')}.png`) });
    console.log(q, '->', JSON.stringify(results[q]));
  }
  await page.context().close();
  return results;
}

(async () => {
  const browser = await chromium.launch();
  try {
    if (phase === 'login') { await login(browser); console.log('ok'); }
    if (phase === 'base') save('base.json', await sweep(browser, 'base', {}));
    if (phase === 'dark') save('dark.json', await sweep(browser, 'dark', { colorScheme: 'dark' }, { scroll: false }));
    if (phase === 'laptop') save('laptop.json', await sweep(browser, 'laptop', { viewport: { width: 1366, height: 768 } }, { scroll: false, doAxe: false }));
    if (phase === 'phone') save('phone.json', await sweep(browser, 'phone', { viewport: { width: 390, height: 844 }, touch: true, mobile: true }, { scroll: true, doAxe: false, maxShots: 2 }));
    if (phase === 'density') save('density.json', await sweep(browser, 'density', { density: 'compact' }, { scroll: false, doAxe: true }));
    if (phase === 'focus') save('focus.json', await focusPhase(browser));
    if (phase === 'dirty') save('dirty.json', await dirtyPhase(browser));
    if (phase === 'search') save('search.json', await searchPhase(browser));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
