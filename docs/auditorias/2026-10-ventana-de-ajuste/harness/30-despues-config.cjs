// Capturas «después» de la Configuración general: cada sección, buscador, guardia de cambios,
// tamaños, rol restringido, tema oscuro y formato regional. Todo lo que cambia se restaura.
process.env.CAP_DIR = process.env.CAP_DIR || 'capturas-despues';
const fs = require('fs');
const path = require('path');
const { launch, instrument, uiLogin, snap, go, api } = require('./lib.cjs');
const DIR = path.resolve(__dirname, '..', process.env.CAP_DIR, 'config');
fs.mkdirSync(DIR, { recursive: true });
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v)}`);
const RESTRICTED = { email: 'qa7734.consulta@example.test', password: 'QA-7734-Consulta-2026!' };

async function open(page, id) {
  await page.evaluate((s) => { location.hash = 'settings/' + s; }, id);
  await page.locator('.sm-panel').waitFor();
  await page.waitForTimeout(1800);
}

async function full(page, file) {
  const handle = await page.addStyleTag({ content: '.sm-panel{height:auto!important;max-height:none!important}.sm-body,.sm-content{overflow:visible!important;max-height:none!important}app-settings-modal{position:absolute!important}' });
  await page.waitForTimeout(300);
  await page.locator('.sm-content').screenshot({ path: path.join(DIR, file) }).catch((e) => console.log('full fail', e.message));
  await handle.evaluate((el) => el.remove());
}

(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  await go(page, 'overview');

  // ── Apertura y recorrido de todas las secciones ─────────────────────────────────────────────
  await open(page, 'my-profile');
  await snap(page, '81-config-abierta');
  out('título pestaña', await page.title());
  out('foco al abrir', await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
  const ids = await page.locator('.sm-nav .nav-link').evaluateAll((els) => els.map((e) => e.innerText.trim()));
  out('secciones visibles', ids);
  const sections = [];
  for (let i = 0; i < ids.length; i++) {
    const n0 = log.requests.length;
    await page.locator('.sm-nav .nav-link').nth(i).click();
    await page.waitForTimeout(2200);
    const dialog = await page.locator('.cdk-overlay-container [role=dialog], app-dialog-host [role=dialog]').count();
    const id = (page.url().split('#settings/')[1] || '').split('/')[0];
    const n = String(i + 1).padStart(2, '0');
    await page.screenshot({ path: path.join(DIR, `${n}-${id}-pliegue.png`) });
    await full(page, `${n}-${id}-completa.png`);
    const info = await page.evaluate(() => {
      const c = document.querySelector('.sm-content');
      const h1 = c.querySelector('h1');
      const scope = c.querySelector('.sm-scope')?.innerText;
      const errors = [...c.querySelectorAll('[role=alert]')].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 2);
      const page = c.querySelector('.sm-page');
      return { titulo: h1?.innerText.trim(), alcance: scope, ancho: Math.round(page.getBoundingClientRect().width), errores: errors };
    });
    const http = log.requests.slice(n0).filter((r) => typeof r.status === 'number' && r.status >= 400).map((r) => `${r.method} ${r.url} ${r.status}`);
    sections.push({ n, id, nav: ids[i], stepUpAlEntrar: !!dialog, ...info, http });
    if (dialog) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  }
  for (const s of sections) console.log(`${s.n} ${s.id.padEnd(22)} | ${String(s.titulo).padEnd(34)} | ${s.alcance} | ancho ${s.ancho} | stepUp ${s.stepUpAlEntrar} | ${s.errores.join(' / ')} ${s.http.join(' ')}`);
  fs.writeFileSync(path.resolve(__dirname, '../config-secciones-despues.json'), JSON.stringify(sections, null, 1));

  // ── Buscador ────────────────────────────────────────────────────────────────────────────────
  await open(page, 'my-profile');
  await page.locator('#settings-search').fill('itbis');
  await page.waitForTimeout(500);
  await snap(page, 'C-buscar-itbis');
  out('resultados itbis', await page.locator('.nav-link--result .nav-link__label').allInnerTexts());
  await page.locator('#settings-search').fill('');

  // ── Cambio sin guardar + Escape: ahora pregunta ────────────────────────────────────────────
  await open(page, 'profile');
  const website = page.locator('.sm-content input[formcontrolname=website]');
  const before = await website.inputValue().catch(() => null);
  if (before !== null) {
    await website.fill('https://qa-7734.example.test');
    await page.waitForTimeout(400);
    await snap(page, '83-config-cambio-sin-guardar');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await snap(page, '84-config-tras-escape');
    out('diálogo al salir', await page.locator('[role=dialog], [role=alertdialog]').last().innerText().catch(() => '-'));
    // «Seguir editando» y descartar: nada se guarda.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await website.fill(before);
  }

  // ── Cuentas predeterminadas: una pantalla, un guardado ─────────────────────────────────────
  await open(page, 'default-accounts');
  await snap(page, '82-config-cuentas-predeterminadas');
  await open(page, 'inventory-policies');
  out('alias antiguo inventory-policies →', page.url());
  await snap(page, '82-config-alias-inventario');

  // ── Secuencias: confirmar antes de cambiar la numeración (se cancela) ──────────────────────
  await open(page, 'sequences');
  const prefix = page.locator('.seq__input').first();
  if (await prefix.count()) {
    const original = await prefix.inputValue();
    await prefix.fill(original + 'X');
    await page.waitForTimeout(300);
    await snap(page, 'C-secuencias-cambio');
    await page.locator('vx-settings-save-bar .primary-button').click().catch(() => {});
    await page.waitForTimeout(600);
    await snap(page, 'C-secuencias-confirmar');
    await page.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: /Cancelar/ }).first().click().catch(() => page.keyboard.press('Escape'));
    await page.waitForTimeout(400);
    await page.locator('vx-settings-save-bar .secondary-button').click().catch(() => {});
  }

  // ── Formato regional: empresa y persona (se restaura) ──────────────────────────────────────
  const companyBefore = (await api(page, 'GET', '/organizations/regional-format')).body;
  await open(page, 'regional-format');
  await snap(page, 'R-formato-empresa');
  await full(page, 'R-formato-empresa-completa.png');
  await open(page, 'preferences');
  await page.locator('app-regional-format-page').scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  await snap(page, 'R-preferencias-formato');
  // Elegir para la persona: año primero y coma decimal.
  const selects = page.locator('app-regional-format-page select');
  await selects.nth(0).selectOption('YMD');
  await page.waitForTimeout(700);
  await selects.nth(1).selectOption('-');
  await page.waitForTimeout(700);
  await selects.nth(2).selectOption('dot_comma');
  await page.waitForTimeout(900);
  await snap(page, 'R-preferencias-formato-elegido');
  out('autoguardado', await page.locator('.sm-autosave').innerText().catch(() => '-'));
  // Cómo se ve la aplicación con ese formato.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await go(page, 'inventory/adjustments');
  await page.waitForTimeout(2200);
  await snap(page, 'R-lista-ajustes-con-formato');
  await go(page, 'inventory/stock');
  await page.waitForTimeout(2200);
  await snap(page, 'R-existencias-con-formato');
  // Restaurar desde la propia interfaz: «Usar el formato de la empresa en todo».
  await go(page, 'overview');
  await open(page, 'preferences');
  await page.locator('app-regional-format-page .rfp__link').click();
  await page.waitForTimeout(1200);
  out('formato tras restaurar', await page.locator('app-regional-format-page dd').first().innerText());
  const restored = await api(page, 'PATCH', '/users/profile', { regionalFormat: null });
  const companyRestored = await api(page, 'PUT', '/organizations/regional-format', companyBefore || {});
  out('restaurado (persona, empresa)', [restored.status, companyRestored.status]);

  // ── Seguridad: política y pista de auditoría ───────────────────────────────────────────────
  await go(page, 'overview');
  await open(page, 'audit-trail');
  await snap(page, '21-pista-auditoria');
  await open(page, 'security');
  await snap(page, '21-politica-seguridad');

  // ── Tema oscuro y tamaños ──────────────────────────────────────────────────────────────────
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await open(page, 'preferences');
  await snap(page, 'Y-1366-oscuro-preferencias');
  await open(page, 'branding');
  await snap(page, 'Y-1366-oscuro-branding');
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.emulateMedia({ colorScheme: 'light' });
  for (const [name, size] of [['C-cfg-1366', { width: 1366, height: 768 }], ['C-cfg-tableta', { width: 820, height: 1180 }], ['C-cfg-movil', { width: 375, height: 812 }]]) {
    await page.setViewportSize(size);
    await open(page, 'default-accounts');
    await snap(page, name);
    if (name === 'C-cfg-movil') {
      await page.locator('.sm-back').click().catch(() => {});
      await page.waitForTimeout(400);
      await snap(page, 'C-cfg-movil-lista');
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.close();

  // ── Rol restringido: solo lo que puede ver, y en solo lectura ──────────────────────────────
  const restricted = await context.browser().newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
  const rp = await restricted.newPage();
  await uiLogin(rp, RESTRICTED);
  await go(rp, 'overview');
  await open(rp, 'my-profile');
  await snap(rp, 'C-restringido');
  out('secciones del restringido', await rp.locator('.sm-nav .nav-link').allInnerTexts());
  await open(rp, 'default-accounts');
  await snap(rp, 'Y-restringido-accounting');
  await open(rp, 'sequences');
  await snap(rp, 'Y-restringido-sequences');
  await open(rp, 'profile');
  await snap(rp, 'Y-restringido-perfil-empresa');
  await restricted.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
