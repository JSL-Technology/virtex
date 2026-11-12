// Capturas de evidencia (deviceScaleFactor 2) con el elemento señalado en rojo.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'salida');
const OUT = path.join(ROOT, 'evidencia');
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
  await page.evaluate(() => { document.querySelectorAll('.__hl-badge').forEach((b) => b.remove()); document.querySelectorAll('.__hl').forEach((e) => e.classList.remove('__hl')); });
  await page.evaluate((s) => { location.hash = '#settings/' + s; }, id);
  await page.waitForSelector('.sm-panel');
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
// Marca elementos: cada entrada es {sel} o {text} (busca el elemento más pequeño que contiene el texto dentro de la modal).
async function mark(page, targets, { scroll = true } = {}) {
  return page.evaluate(({ targets, scroll }) => {
    document.querySelectorAll('.__hl-badge').forEach((b) => b.remove());
    document.querySelectorAll('.__hl').forEach((e) => e.classList.remove('__hl'));
    if (!document.getElementById('__hl-style')) {
      const s = document.createElement('style'); s.id = '__hl-style';
      s.textContent = '.__hl{outline:3px solid #e5484d !important;outline-offset:3px !important;} .__hl-badge{position:fixed;z-index:2147483647;background:#e5484d;color:#fff;font:700 12px/20px system-ui;min-width:20px;height:20px;border-radius:10px;text-align:center;padding:0 5px;pointer-events:none;box-shadow:0 0 0 2px #fff}';
      document.head.appendChild(s);
    }
    const root = document.querySelector('.sm-panel') || document.body;
    const byText = (t) => { let best = null; for (const el of root.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; if ((el.innerText || '').includes(t)) { if (!best || el.contains(best) === false && best.contains(el)) best = el; else if (!best.contains(el) && !el.contains(best)) { /* keep first */ } } } return best; };
    const found = [];
    targets.forEach((t, i) => {
      let els = t.sel ? [...root.querySelectorAll(t.sel)] : [byText(t.text)].filter(Boolean);
      if (t.nth !== undefined) els = els.slice(t.nth, t.nth + 1);
      if (t.max) els = els.slice(0, t.max);
      els.forEach((el) => { el.classList.add('__hl'); found.push({ i: i + 1, el }); });
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
    const fresh = await page.evaluate(() => [...document.querySelectorAll('.__hl')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }));
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
  await page.evaluate(() => { const hs = [...document.querySelectorAll('.__hl')]; const bs = [...document.querySelectorAll('.__hl-badge')]; hs.forEach((e, i) => { const r = e.getBoundingClientRect(); if (bs[i]) { bs[i].style.left = Math.max(0, r.left - 14) + 'px'; bs[i].style.top = Math.max(0, r.top - 14) + 'px'; } }); });
}
async function step(name, fn) { if (ONLY && !ONLY.split(',').includes(name)) return; try { await fn(); } catch (e) { console.log('FAIL', name, String(e).slice(0, 200)); log[name] = { error: String(e).slice(0, 300) }; } }

(async () => {
  const browser = await chromium.launch();
  const page = await ctxPage(browser);

  await step('primarias', async () => {
    await open(page, 'account-security');
    const r = await mark(page, [{ text: 'Activar' , sel: '.sm-section button.primary-button, .sm-section .btn-primary' }]);
    await badgesRefresh(page); await snap(page, 'E07-dos-primarias-seguridad-cuenta.png', r, 120);
    await open(page, 'subsidiaries');
    const r2 = await mark(page, [{ text: 'Nueva subsidiaria' }, { text: 'Crear primera subsidiaria' }]);
    await snap(page, 'E07b-primaria-duplicada-estructura.png', r2, 60, true);
    await open(page, 'fiscal');
    log.fiscalPrimaries = await page.evaluate(() => [...document.querySelectorAll('.sm-section button')].filter((b) => /primary/.test(b.className)).map((b) => ({ t: b.innerText.trim(), disabled: b.disabled })));
  });

  await step('titulos', async () => {
    await open(page, 'account-security');
    const r = await mark(page, [{ sel: '.sm-section h2' }, { sel: '.sm-section h3', max: 1 }]);
    await badgesRefresh(page); await snap(page, 'E08-jerarquia-invertida-seguridad-cuenta.png', r, 90);
    await open(page, 'default-accounts');
    const r2 = await mark(page, [{ sel: '.sm-section h2', nth: 0 }, { sel: '.sm-section h2', nth: 1 }]);
    await badgesRefresh(page); await snap(page, 'E08b-h2-de-dos-tamanos-cuentas.png', r2, 90);
    await open(page, 'my-profile');
    const r3 = await mark(page, [{ sel: '.sm-page__title' }, { sel: '.sm-section h1' }]);
    await badgesRefresh(page); await snap(page, 'E08c-dos-h1-mi-perfil.png', r3, 60);
  });

  await step('tarjetas', async () => {
    await open(page, 'account-security');
    const r = await mark(page, [{ text: 'Actualizar contraseña' }], { scroll: false });
    await page.evaluate(() => document.querySelectorAll('.__hl-badge, .__hl').forEach((e) => { e.classList?.remove('__hl'); if (e.classList?.contains('__hl-badge')) e.remove(); }));
    await page.evaluate(() => { const c = document.querySelector('.sm-content'); c.scrollTop = 330; });
    await page.waitForTimeout(300);
    // Señalar la separación entre tarjetas.
    const gaps = await page.evaluate(() => { const cards = [...document.querySelectorAll('.sm-section *')].filter((el) => { const cs = getComputedStyle(el); return parseFloat(cs.borderTopWidth) >= 1 && parseFloat(cs.borderTopLeftRadius) >= 4 && el.getBoundingClientRect().height > 80 && el.getBoundingClientRect().width > 600; }); const top = cards.filter((c) => !cards.some((o) => o !== c && o.contains(c))); const out = []; for (let i = 0; i < top.length - 1; i++) { const a = top[i].getBoundingClientRect(), b = top[i + 1].getBoundingClientRect(); out.push(Math.round(b.top - a.bottom)); } return out; });
    log.gapsAccountSecurity = gaps;
    await page.screenshot({ path: path.join(OUT, 'E10-tarjetas-pegadas-seguridad-cuenta.png'), clip: { x: 340, y: 380, width: 1030, height: 360 } });
    await open(page, 'profile');
    log.gapsProfile = await page.evaluate(() => { const cards = [...document.querySelectorAll('.sm-section *')].filter((el) => { const cs = getComputedStyle(el); return parseFloat(cs.borderTopWidth) >= 1 && parseFloat(cs.borderTopLeftRadius) >= 4 && el.getBoundingClientRect().height > 80 && el.getBoundingClientRect().width > 600; }); const top = cards.filter((c) => !cards.some((o) => o !== c && o.contains(c))); const out = []; for (let i = 0; i < top.length - 1; i++) { const a = top[i].getBoundingClientRect(), b = top[i + 1].getBoundingClientRect(); out.push(Math.round(b.top - a.bottom)); } return out; });
    await open(page, 'my-profile');
    log.gapsMyProfile = await page.evaluate(() => { const cards = [...document.querySelectorAll('.sm-section *')].filter((el) => { const cs = getComputedStyle(el); return parseFloat(cs.borderTopWidth) >= 1 && parseFloat(cs.borderTopLeftRadius) >= 4 && el.getBoundingClientRect().height > 80 && el.getBoundingClientRect().width > 600; }); const top = cards.filter((c) => !cards.some((o) => o !== c && o.contains(c))); const out = []; for (let i = 0; i < top.length - 1; i++) { const a = top[i].getBoundingClientRect(), b = top[i + 1].getBoundingClientRect(); out.push(Math.round(b.top - a.bottom)); } return out; });
    // Cuatro anatomías de cabecera de tarjeta.
    const heads = [['my-profile', 'Información personal', 'E09a-tarjeta-banda-gris-icono.png'], ['profile', 'Información general', 'E09b-tarjeta-banda-gris-subtitulo.png'], ['account-security', 'Llaves de acceso', 'E09c-tarjeta-icono-circular.png'], ['billing', 'PLAN ACTUAL', 'E09d-tarjeta-cabecera-mayusculas.png']];
    for (const [id, t, f] of heads) { await open(page, id); const rr = await mark(page, [{ text: t }]); await page.evaluate(() => document.querySelectorAll('.__hl-badge').forEach((b) => b.remove())); await page.evaluate(() => document.querySelectorAll('.__hl').forEach((e) => e.classList.remove('__hl'))); const box = await page.evaluate((txt) => { const all = [...document.querySelectorAll('.sm-section *')]; const el = all.find((e) => e.children.length < 3 && (e.innerText || '').trim().startsWith(txt)); let c = el; while (c && !(parseFloat(getComputedStyle(c).borderTopWidth) >= 1 && parseFloat(getComputedStyle(c).borderTopLeftRadius) >= 4 && c.getBoundingClientRect().height > 60)) c = c.parentElement; const r = (c || el).getBoundingClientRect(); return { x: r.left - 8, y: r.top - 8, width: Math.min(r.width + 16, 1100), height: Math.min(r.height + 16, 260) }; }, t); await page.screenshot({ path: path.join(OUT, f), clip: box }); }
  });

  await step('vacios', async () => {
    await open(page, 'sso');
    const r = await mark(page, [{ text: 'Aún no has agregado dominios.' }, { text: 'No hay proveedores configurados.' }]);
    await badgesRefresh(page); await snap(page, 'E13-dos-estados-vacios-en-sso.png', r, 40, true);
    await open(page, 'audit-trail');
    const r2 = await mark(page, [{ text: 'No hay registros con estos filtros.' }]);
    await snap(page, 'E13b-vacio-texto-plano-pista.png', r2, 220);
    await open(page, 'extensions');
    const r3 = await mark(page, [{ text: 'Todavía no hay extensiones instaladas.' }]);
    await snap(page, 'E13c-vacio-sin-titulo-extensiones.png', r3, 120);
  });

  await step('colores', async () => {
    await open(page, 'integrations');
    const r = await mark(page, [{ text: 'Activa' , sel: '.sm-section [class*="chip"], .sm-section [class*="badge"], .sm-section [class*="status"]' }]);
    log.integrationChips = await page.evaluate(() => [...document.querySelectorAll('.__hl')].map((e) => e.innerText.trim()).slice(0, 6));
    await page.evaluate(() => { document.querySelectorAll('.__hl').forEach((e) => { if (e.innerText.trim() !== 'Activa') e.classList.remove('__hl'); }); document.querySelectorAll('.__hl-badge').forEach((b) => b.remove()); });
    await snap(page, 'E14a-activa-neutro-integraciones.png', await page.evaluate(() => [...document.querySelectorAll('.__hl')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })), 160);
    await open(page, 'users');
    const r2 = await mark(page, [{ text: 'Activo', sel: '.sm-section td span, .sm-section td [class*="badge"], .sm-section td [class*="status"]' }]);
    await page.evaluate(() => { document.querySelectorAll('.__hl').forEach((e) => { if (e.innerText.trim() !== 'Activo') e.classList.remove('__hl'); }); document.querySelectorAll('.__hl-badge').forEach((b) => b.remove()); });
    await snap(page, 'E14b-activo-verde-usuarios.png', await page.evaluate(() => [...document.querySelectorAll('.__hl')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })), 120);
    await open(page, 'fiscal');
    const r3 = await mark(page, [{ text: 'Todavía no puedes emitir comprobantes' }]);
    await snap(page, 'E14c-aviso-gris-comprobantes.png', r3, 30);
    await open(page, 'smtp');
    const r4 = await mark(page, [{ text: 'Ni aquí ni en el perfil' }]);
    await snap(page, 'E14d-aviso-amarillo-correo.png', r4, 30);
  });

  await step('textos', async () => {
    await open(page, 'ai');
    const r = await mark(page, [{ text: 'ai.admin.state.engine_offline' }]);
    await badgesRefresh(page); await snap(page, 'E15-clave-cruda-ia.png', r, 120);
    await open(page, 'preferences');
    const r2 = await mark(page, [{ text: 'se aplican al instante en este equipo' }, { text: 'Solo para ti y en todos tus dispositivos' }]);
    await badgesRefresh(page); await snap(page, 'E16a-contradiccion-preferencias.png', r2, 30, true);
    const r2b = await mark(page, [{ text: 'Solo para ti y en todos tus dispositivos' }]);
    await badgesRefresh(page); await snap(page, 'E16a2-contradiccion-preferencias-dispositivos.png', r2b, 60);
    await page.evaluate(() => { document.querySelector('.sm-content').scrollTop = 0; });
    const r3 = await mark(page, [{ text: 'Los documentos fiscales conservan el idioma' }, { text: 'Los documentos usan el idioma de la empresa' }]);
    await badgesRefresh(page); await snap(page, 'E16b-ayuda-duplicada-idioma.png', r3, 60);
    await open(page, 'security');
    const r4 = await mark(page, [{ text: 'Los miembros que aún no lo tienen' }, { text: 'Al activarlo, quien aún no use' }]);
    await badgesRefresh(page); await snap(page, 'E16c-explicacion-repetida-seguridad.png', r4, 50);
    await open(page, 'approvals');
    const r5 = await mark(page, [{ text: 'Los documentos se registran sin pasar' }, { text: 'Sin políticas, los documentos se contabilizan' }]);
    await badgesRefresh(page); await snap(page, 'E16d-titulo-y-cuerpo-repetidos-aprobaciones.png', r5, 60);
    await open(page, 'fiscal');
    const r6 = await mark(page, [{ text: '(Ajustes › Comprobantes fiscales' }, { text: '(Ajustes › Perfil de la empresa)' }]);
    await badgesRefresh(page); await snap(page, 'E17-nombres-incorrectos-comprobantes.png', r6, 50);
    await open(page, 'billing');
    const r7 = await mark(page, [{ text: 'PLAN ACTUAL' }, { text: 'MÉTODO DE PAGO' }]);
    await badgesRefresh(page); await snap(page, 'E24a-mayusculas-plan.png', r7, 40);
    await page.evaluate(() => { document.querySelector('.sm-content').scrollTop = 330; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'E24b-minusculas-lista-uso.png'), clip: { x: 340, y: 120, width: 1030, height: 560 } });
    // Formatos de moneda.
    await open(page, 'ai');
    const r8 = await mark(page, [{ text: 'Gastado este mes' }]);
    await snap(page, 'E18a-moneda-ia.png', r8, 40);
    await open(page, 'billing');
    const r9 = await mark(page, [{ text: 'US$199' }]);
    await snap(page, 'E18b-moneda-plan.png', r9, 40);
  });

  await step('a11y', async () => {
    await open(page, 'users');
    const r = await mark(page, [{ sel: '#btnRefresh' }, { sel: '.sm-section .btn-icon' }, { sel: '.sm-section th input[type="checkbox"]' }, { sel: '.sm-section td input[type="checkbox"]' }]);
    await badgesRefresh(page); await snap(page, 'E04-usuarios-sin-nombre-accesible.png', r, 60);
    // Seguridad de la cuenta: el campo oculto recibe foco.
    await open(page, 'account-security');
    await page.focus('#settings-section-title');
    for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); const ac = await page.evaluate(() => document.activeElement?.getAttribute('autocomplete')); if (ac === 'username') break; }
    log.hiddenUsername = await page.evaluate(() => { const el = document.activeElement; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { tag: el.tagName, type: el.type, autocomplete: el.getAttribute('autocomplete'), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], opacity: cs.opacity, position: cs.position, clip: cs.clip, ariaHidden: el.getAttribute('aria-hidden'), tabindex: el.getAttribute('tabindex') }; });
    await page.screenshot({ path: path.join(OUT, 'E06-foco-en-campo-oculto.png'), clip: { x: 340, y: 230, width: 1030, height: 460 } });
    // Botones de subir archivo: ¿se ve el foco?
    const files = [['my-profile', 'E06b-foco-subir-foto.png'], ['branding', 'E06c-foco-subir-logo.png'], ['fiscal', 'E06d-foco-certificado.png']];
    log.fileFocus = {};
    for (const [id, f] of files) {
      await open(page, id); await page.focus('#settings-section-title');
      for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); const t = await page.evaluate(() => document.activeElement?.type); if (t === 'file') break; }
      log.fileFocus[id] = await page.evaluate(() => { const el = document.activeElement; const lab = el.closest('label') || document.querySelector(`label[for="${el.id}"]`); const ls = lab ? getComputedStyle(lab) : null; return { type: el.type, id: el.id, labelOutline: ls ? ls.outlineStyle + ' ' + ls.outlineWidth : null, labelShadow: ls ? ls.boxShadow : null }; });
      const rect = await page.evaluate(() => { const el = document.activeElement; const lab = el.closest('label') || document.querySelector(`label[for="${el.id}"]`) || el.parentElement; const r = lab.getBoundingClientRect(); return { x: Math.max(0, r.left - 120), y: Math.max(0, r.top - 80), width: Math.min(700, r.width + 240), height: Math.min(400, r.height + 160) }; });
      await page.screenshot({ path: path.join(OUT, f), clip: rect });
    }
  });

  await step('dark', async () => {
    const dp = await ctxPage(browser, { dark: true });
    await open(dp, 'my-profile');
    const r = await mark(dp, [{ sel: '.p-banner-role' }, { sel: '.pf-verify-btn', max: 2 }], { scroll: false });
    await badgesRefresh(dp); await snap(dp, 'E03-contraste-oscuro-mi-perfil.png', r, 40, true);
    await open(dp, 'branding');
    const r2 = await mark(dp, [{ sel: '.logo-placeholder' }, { sel: '.nav-placeholder' }]);
    await badgesRefresh(dp); await snap(dp, 'E03b-contraste-oscuro-marca.png', r2, 80);
    await dp.context().close();
  });

  await step('roles', async () => {
    await open(page, 'roles');
    const r = await mark(page, [{ sel: '.sm-section td button[disabled], .sm-section td button[aria-disabled="true"]', max: 2 }]);
    log.rolesDisabled = await page.evaluate(() => [...document.querySelectorAll('.sm-section td button')].slice(0, 3).map((b) => ({ disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'), title: b.title, aria: b.getAttribute('aria-label'), tabindex: b.tabIndex })));
    await badgesRefresh(page); await snap(page, 'E19a-roles-deshabilitados-solo-title.png', r, 110);
    await open(page, 'users');
    const r2 = await mark(page, [{ sel: '.sm-section .btn-icon' }]);
    await badgesRefresh(page); await snap(page, 'E19b-usuarios-menu-de-fila.png', r2, 110);
  });

  await step('otros', async () => {
    await open(page, 'branding');
    const r = await mark(page, [{ text: 'Aceptar', sel: '.sm-section button' }]);
    await page.evaluate(() => { document.querySelectorAll('.__hl').forEach((e) => { if (!['Aceptar', 'Cancelar'].includes(e.innerText.trim())) e.classList.remove('__hl'); }); document.querySelectorAll('.__hl-badge').forEach((b) => b.remove()); });
    await snap(page, 'E21-controles-de-muestra-marca.png', await page.evaluate(() => [...document.querySelectorAll('.__hl')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })), 160);
    await open(page, 'integrations');
    await page.screenshot({ path: path.join(OUT, 'E23-integraciones-rejilla-3-mas-1.png'), clip: { x: 340, y: 240, width: 1030, height: 420 } });
    await open(page, 'audit-trail');
    const r3 = await mark(page, [{ text: 'Desde' , sel: '.sm-section label, .sm-section .field label, .sm-section span' }]);
    await page.evaluate(() => { document.querySelectorAll('.__hl').forEach((e) => { if (!['Desde', 'Hasta'].includes(e.innerText.trim())) e.classList.remove('__hl'); }); document.querySelectorAll('.__hl-badge').forEach((b) => b.remove()); });
    await page.screenshot({ path: path.join(OUT, 'E22-pista-desde-hasta-separados.png'), clip: { x: 340, y: 250, width: 1030, height: 440 } });
    await open(page, 'account-security');
    await page.evaluate(() => { document.querySelector('.sm-content').scrollTop = 600; });
    await page.waitForTimeout(300);
    const r4 = await mark(page, [{ text: 'sesiones en este dispositivo' }], { scroll: false });
    await page.evaluate(() => { document.querySelectorAll('.__hl').forEach((e, i) => { if (i > 0) e.classList.remove('__hl'); }); });
    await badgesRefresh(page); await snap(page, 'E26-enlace-desalineado-sesiones.png', r4, 90);
    await open(page, 'extensions');
    const r5 = await mark(page, [{ text: 'Abrir ejecución', sel: '.sm-section button' }]);
    await page.evaluate(() => { document.querySelectorAll('.__hl').forEach((e) => { if (!/Abrir ejecución|Actualizar/.test(e.innerText)) e.classList.remove('__hl'); }); document.querySelectorAll('.__hl-badge').forEach((b) => b.remove()); });
    await page.screenshot({ path: path.join(OUT, 'E27-extensiones-acciones-fuera-de-cabecera.png'), clip: { x: 340, y: 90, width: 1030, height: 260 } });
    await open(page, 'my-profile');
    const r6 = await mark(page, [{ text: 'Nombre', sel: '.sm-section label' }]);
    await page.evaluate(() => { document.querySelectorAll('.__hl').forEach((e, i) => { if (i > 0) e.classList.remove('__hl'); }); document.querySelectorAll('.__hl-badge').forEach((b) => b.remove()); });
    await page.screenshot({ path: path.join(OUT, 'E25a-obligatorio-rojo-mi-perfil.png'), clip: { x: 370, y: 490, width: 520, height: 90 } });
    await open(page, 'fiscal');
    const rr = await page.evaluate(() => { const el = [...document.querySelectorAll('.sm-section label')].find((l) => l.innerText.trim().startsWith('Tipo')); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left - 20, y: r.top - 20, width: 700, height: 90 }; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'E25b-obligatorio-gris-comprobantes.png'), clip: rr });
    await open(page, 'my-profile');
    await page.evaluate(() => { document.querySelector('.sm-content').scrollTop = 250; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'E28-campos-de-ancho-completo.png'), clip: { x: 340, y: 300, width: 1030, height: 420 } });
    // Buscador: «firma».
    await page.fill('#settings-search', 'firma'); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'E27b-buscador-firma.png'), clip: { x: 40, y: 78, width: 560, height: 300 } });
    await page.fill('#settings-search', '');
  });

  await step('confirmaciones', async () => {
    log.confirm = {};
    await open(page, 'branding');
    await page.getByRole('button', { name: 'Restablecer marca' }).click(); await page.waitForTimeout(700);
    log.confirm.brandingReset = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].filter((d) => !d.classList.contains('sm-panel')).map((d) => d.innerText.replace(/\s+/g, ' ').trim().slice(0, 160)));
    await page.screenshot({ path: path.join(OUT, 'E29a-confirmacion-restablecer-marca.png') });
    await page.getByRole('button', { name: 'Cancelar', exact: true }).last().click().catch(() => {}); await page.waitForTimeout(400);
    await open(page, 'account-security');
    const closeOthers = page.getByRole('button', { name: /Cerrar las demás sesiones/ });
    if (await closeOthers.count()) { await closeOthers.click(); await page.waitForTimeout(700); }
    log.confirm.closeSessions = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].filter((d) => !d.classList.contains('sm-panel')).map((d) => d.innerText.replace(/\s+/g, ' ').trim().slice(0, 160)));
    await page.screenshot({ path: path.join(OUT, 'E29b-confirmacion-cerrar-sesiones.png') });
    await page.getByRole('button', { name: 'Cancelar', exact: true }).last().click().catch(() => {}); await page.waitForTimeout(400);
  });

  await step('tabulares', async () => {
    log.tabular = {};
    for (const [id, texts] of [['billing', ['US$199', '0 · ilimitado']], ['ai', ['US$ 0.00']], ['sequences', ['FAC-00000001']]]) {
      await open(page, id);
      log.tabular[id] = await page.evaluate((texts) => texts.map((t) => { const el = [...document.querySelectorAll('.sm-section *')].find((e) => e.children.length === 0 && (e.innerText || '').includes(t)) || [...document.querySelectorAll('.sm-section *')].reverse().find((e) => (e.innerText || '').includes(t)); return el ? { t, fvn: getComputedStyle(el).fontVariantNumeric, ff: getComputedStyle(el).fontFamily.slice(0, 30) } : { t, missing: true }; }), texts);
    }
  });

  await step('smtpx', async () => {
    await open(page, 'smtp');
    const input = page.locator('.sm-section input').first();
    await input.click(); await page.keyboard.type('Prueba X');
    await page.click('.sm-close'); await page.waitForTimeout(800);
    log.smtpCloseButton = await page.evaluate(() => ({ modalOpen: !!document.querySelector('.sm-panel'), confirm: [...document.querySelectorAll('[role="dialog"]')].filter((d) => !d.classList.contains('sm-panel')).length }));
  });

  await step('movil', async () => {
    const mp = await ctxPage(browser, { viewport: { width: 390, height: 844 }, mobile: true });
    await open(mp, 'users');
    await mp.screenshot({ path: path.join(OUT, 'E20a-movil-usuarios-recortado.png') });
    await open(mp, 'roles');
    await mp.screenshot({ path: path.join(OUT, 'E20b-movil-roles.png') });
    await mp.context().close();
  });

  // Buenas prácticas observadas (para el informe).
  await step('positivos', async () => {
    await open(page, 'profile');
    const input = page.locator('.sm-section input').first();
    await input.click(); await page.keyboard.press('End'); await page.keyboard.type(' S.R.L.');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'P01-barra-de-guardado-con-motivo.png'), clip: { x: 305, y: 700, width: 1095, height: 184 } });
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'P02-aviso-de-cambios-sin-guardar.png') });
    await page.getByRole('button', { name: 'Descartar', exact: true }).last().click().catch(() => {});
    await page.waitForTimeout(500);
  });

  fs.writeFileSync(path.join(ROOT, 'results', 'evidence-log.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
