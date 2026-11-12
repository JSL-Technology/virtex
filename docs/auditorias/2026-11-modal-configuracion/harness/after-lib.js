// Capturas «después» (deviceScaleFactor 2): lo corregido, señalado en verde.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'salida');
const OUT = path.join(ROOT, 'after');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4200';
const STATE = path.join(__dirname, 'state.json');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const log = {};

async function ctxPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: opts.dark ? 'dark' : 'light', locale: 'es-DO', storageState: STATE, hasTouch: !!opts.mobile, isMobile: !!opts.mobile });
  const page = await ctx.newPage();
  await page.goto(BASE + '/e/virtex-dev/overview', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1200);
  return page;
}
async function open(page, id) {
  await page.evaluate(() => { document.querySelectorAll('.__hl-badge').forEach((b) => b.remove()); document.querySelectorAll('.__hl, .__hlq').forEach((e) => e.classList.remove('__hl', '__hlq')); });
  await page.evaluate((s) => { location.hash = '#settings/' + s; }, id);
  await page.waitForSelector('.sm-panel');
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
// Marca elementos: cada entrada es {sel} o {text} (busca el elemento más pequeño que contiene el texto dentro de la modal).
async function mark(page, targets, { scroll = true } = {}) {
  return page.evaluate(({ targets, scroll }) => {
    document.querySelectorAll('.__hl-badge').forEach((b) => b.remove());
    document.querySelectorAll('.__hl, .__hlq').forEach((e) => e.classList.remove('__hl', '__hlq'));
    if (!document.getElementById('__hl-style')) {
      const s = document.createElement('style'); s.id = '__hl-style';
      s.textContent = '.__hl{outline:3px solid #30a46c !important;outline-offset:3px !important;} .__hl-badge{position:fixed;z-index:2147483647;background:#30a46c;color:#fff;font:700 12px/20px system-ui;min-width:20px;height:20px;border-radius:10px;text-align:center;padding:0 5px;pointer-events:none;box-shadow:0 0 0 2px #fff}';
      document.head.appendChild(s);
    }
    const root = document.querySelector('.sm-panel') || document.body;
    const byText = (t) => { let best = null; for (const el of root.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; if ((el.innerText || '').includes(t)) { if (!best || el.contains(best) === false && best.contains(el)) best = el; else if (!best.contains(el) && !el.contains(best)) { /* keep first */ } } } return best; };
    const found = [];
    targets.forEach((t, i) => {
      let els = t.sel ? [...root.querySelectorAll(t.sel)] : [byText(t.text)].filter(Boolean);
      if (t.nth !== undefined) els = els.slice(t.nth, t.nth + 1);
      if (t.max) els = els.slice(0, t.max);
      //  `quiet`: solo el número, sin contorno, para no tapar ni imitar un anillo de foco.
      els.forEach((el) => { el.classList.add(t.quiet ? '__hlq' : '__hl'); found.push({ i: i + 1, el }); });
    });
    if (scroll && found[0]) found[0].el.scrollIntoView({ block: 'center' });
    const rects = [];
    found.forEach(({ i, el }) => { const r = el.getBoundingClientRect(); rects.push({ x: r.left, y: r.top, w: r.width, h: r.height }); const b = document.createElement('div'); b.className = '__hl-badge'; b.textContent = String(i); b.style.left = Math.max(0, r.left - 14) + 'px'; b.style.top = Math.max(0, r.top - 14) + 'px'; document.body.appendChild(b); });
    return rects;
  }, { targets, scroll });
}
async function snap(page, name, rects, pad = 70, full = false) {
  await page.waitForTimeout(250);
  // Reposicionar insignias tras el desplazamiento.
  const vp = page.viewportSize();
  let clip;
  if (!full && rects && rects.length) {
    const fresh = await page.evaluate(() => [...document.querySelectorAll('.__hl, .__hlq')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }));
    const rs = fresh.length ? fresh : rects;
    const x1 = Math.max(0, Math.min(...rs.map((r) => r.x)) - pad), y1 = Math.max(0, Math.min(...rs.map((r) => r.y)) - pad);
    const x2 = Math.min(vp.width, Math.max(...rs.map((r) => r.x + r.w)) + pad), y2 = Math.min(vp.height, Math.max(...rs.map((r) => r.y + r.h)) + pad);
    clip = { x: x1, y: y1, width: Math.max(200, x2 - x1), height: Math.max(120, y2 - y1) };
    if (clip.x + clip.width > vp.width) clip.width = vp.width - clip.x;
    if (clip.y + clip.height > vp.height) clip.height = vp.height - clip.y;
  }
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, clip });
  console.log('shot', name);
}
async function badgesRefresh(page) {
  await page.evaluate(() => { const hs = [...document.querySelectorAll('.__hl, .__hlq')]; const bs = [...document.querySelectorAll('.__hl-badge')]; hs.forEach((e, i) => { const r = e.getBoundingClientRect(); if (bs[i]) { bs[i].style.left = Math.max(0, r.left - 14) + 'px'; bs[i].style.top = Math.max(0, r.top - 14) + 'px'; } }); });
}
async function step(name, fn) { if (ONLY && !ONLY.split(',').includes(name)) return; try { await fn(); } catch (e) { console.log('FAIL', name, String(e).slice(0, 200)); log[name] = { error: String(e).slice(0, 300) }; } }


module.exports = { ctxPage, open, mark, snap, badgesRefresh, step, log, OUT, BASE, STATE, ROOT };
