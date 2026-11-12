// PERM-01: sin permiso de edición, la página se ve en solo lectura y dice qué permiso falta.
// Se intercepta GET /auth/session y se quitan los permisos de edición del usuario.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'salida');
const BASE = 'http://localhost:4200';
const STATE = path.join(__dirname, 'state.json');
const SECTIONS = ['profile', 'regional-format', 'branding', 'subsidiaries', 'branches', 'billing', 'users', 'roles', 'security', 'ai', 'extensions', 'default-accounts', 'accounting-policies', 'fiscal', 'withholding-regimes', 'sequences', 'approvals', 'smtp', 'sso', 'integrations'];
const EDIT = /(:edit|:manage|:create|:delete|:update|:invite|:assign|:approve|:write|:resolve|:run|:publish|:revoke|_manage|edit_company|edit_branding)/;
const shot = (name) => { const p = path.join(ROOT, 'shots', 'perm01', name); fs.mkdirSync(path.dirname(p), { recursive: true }); return p; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-DO', storageState: STATE });
  const page = await ctx.newPage();
  let original = null, readonly = null;
  await page.route('**/api/v1/auth/session*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body?.user?.permissions) {
      original = body.user.permissions;
      // El usuario de prueba tiene todos los permisos; se le dejan solo los de lectura.
      const base = original.includes('*') ? JSON.parse(fs.readFileSync(path.join(__dirname, 'view-permissions.json'), 'utf8')) : original;
      readonly = base.filter((p) => p !== '*' && !EDIT.test(p));
      body.user.permissions = readonly;
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto(BASE + '/e/virtex-dev/overview', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  const R = { permissions: { originalCount: original?.length ?? null, wildcard: original?.includes('*') ?? null, readonly } };
  let n = 0;
  for (const id of SECTIONS) {
    n++;
    await page.evaluate((s) => { location.hash = '#settings/' + s; }, id);
    await page.waitForSelector('.sm-panel', { timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector('.sm-section vx-spinner'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const sec = document.querySelector('.sm-section');
      const active = document.querySelector('.sm-nav .nav-link.active, .sm-nav [aria-current="page"]')?.innerText.trim() || null;
      const notice = document.querySelector('.sm-readonly');
      const controls = sec ? [...sec.querySelectorAll('input, select, textarea, button')].filter(vis) : [];
      // Una muestra inerte (la vista previa de Marca) no es un control.
      const isInert = (el) => !!el.closest('[inert]');
      const isFilter = (el) => !!el.closest('.sec__filters, .sec__toolbar, .um-toolbar, .ls__toolbar, .um-page__toolbar, .sec__pager, vx-settings-disclosure, .sd, th, vx-pager, .um-pager, [class*="pager"]') || el.type === 'search' || /search|refresh|retry|reintentar|actualizar|detalles|details|siguiente|anterior|filas por página|25 50 100/i.test((el.getAttribute('aria-label') || el.innerText || '') + ' ' + el.className);
      // Abrir en solo lectura no es editar: «Ver» abre el rol sin poder cambiar nada. Copiar al
      // portapapeles tampoco: la dirección para conectar un agente propio no cambia la empresa.
      const isView = (el) => /^ver\b|^view\b|^copiar\b|^copy\b/i.test((el.getAttribute('aria-label') || el.innerText || '').trim());
      const editable = controls.filter((el) => !isInert(el) && !isFilter(el) && !isView(el) && !(el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true'));
      return {
        visibleTitle: document.querySelector('.sm-page__title')?.innerText.trim() || null,
        denied: !!document.querySelector('.sm-state[role="alert"]'),
        deniedText: document.querySelector('.sm-state[role="alert"]')?.innerText.replace(/\s+/g, ' ').trim() || null,
        notice: notice ? notice.innerText.replace(/\s+/g, ' ').trim() : null,
        saveBar: !!document.querySelector('.ssb'),
        headerActions: [...document.querySelectorAll('.sm-page__actions button, .sm-page__actions a')].filter(vis).map((b) => b.innerText.trim()),
        editable: editable.map((el) => `${el.tagName.toLowerCase()}${el.type ? '[' + el.type + ']' : ''} «${(el.getAttribute('aria-label') || el.innerText || el.id || '').replace(/\s+/g, ' ').trim().slice(0, 40)}»`).slice(0, 12),
      };
    });
    const file = `${String(n).padStart(2, '0')}-${id}-solo-lectura.png`;
    await page.screenshot({ path: shot(file) });
    m.shot = file;
    m.verdict = m.denied || !m.visibleTitle
      ? (m.deniedText && /permiso/.test(m.deniedText) ? 'N/A (leerla exige ese permiso; lo nombra)' : 'NO CUMPLE (denegada sin decir por qué)')
      : m.notice && !m.saveBar && m.editable.length === 0 ? 'CUMPLE' : 'NO CUMPLE';
    R[id] = m;
    console.log(`${id}: notice=${!!m.notice} saveBar=${m.saveBar} header=${JSON.stringify(m.headerActions)} editable=${m.editable.length} → ${m.verdict}${m.editable.length ? ' ' + JSON.stringify(m.editable) : ''}`);
  }
  fs.writeFileSync(path.join(ROOT, 'results', 'perm01.json'), JSON.stringify(R, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
