// Capturas «después», una por hallazgo, con el mismo encuadre que la evidencia «antes».
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const L = require('./after-lib.js');
const { ctxPage, open, mark, snap, badgesRefresh, step, log, OUT } = L;

const dialogText = (page) => page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((d) => !d.closest('.sm-panel')).map((d) => d.innerText.replace(/\s+/g, ' ').trim().slice(0, 200)));
async function tabTo(page, id, max = 90) {
  await page.focus('#settings-section-title').catch(() => {});
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((x) => document.activeElement?.id === x, id)) return true;
  }
  return false;
}
async function tabUntil(page, test, max = 90) {
  await page.focus('#settings-section-title').catch(() => {});
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(test)) return true;
  }
  return false;
}
async function unmark(page) {
  await page.evaluate(() => { document.querySelectorAll('.__hl-badge').forEach((b) => b.remove()); document.querySelectorAll('.__hl, .__hlq').forEach((e) => e.classList.remove('__hl', '__hlq')); });
}
async function closeClean(page) {
  await page.goto(L.BASE + '/e/virtex-dev/overview', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch();
  let page = await ctxPage(browser);

  await step('H01', async () => {
    await open(page, 'smtp');
    await page.locator('#mail-sender').fill('Virtex Prueba');
    await page.waitForTimeout(500);
    let r = await mark(page, [{ sel: '.ssb' }], { scroll: false });
    await badgesRefresh(page); await snap(page, 'A-H01-a-correo-con-cambios-barra.png', r, 0, true);
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    log.H01 = { question: await dialogText(page) };
    await snap(page, 'A-H01-b-correo-escape-pregunta.png', null, 0, true);
    await page.getByRole('button', { name: /Seguir editando|Cancelar/ }).last().click(); await page.waitForTimeout(500);
    log.H01.kept = await page.locator('#mail-sender').inputValue();
    r = await mark(page, [{ sel: '#mail-sender' }]);
    await badgesRefresh(page); await snap(page, 'A-H01-c-correo-valor-conservado.png', r, 90);
    await closeClean(page);
  });

  await step('H02', async () => {
    const dark = await ctxPage(browser, { dark: true });
    await open(dark, 'my-profile');
    let r = await mark(dark, [{ sel: '.p-identity vx-badge' }, { text: 'Cambiar correo', sel: '.pf-btn-secondary' }]);
    await badgesRefresh(dark); await snap(dark, 'A-H02-a-oscuro-mi-perfil.png', r, 80);
    await open(dark, 'branding');
    r = await mark(dark, [{ sel: '.logo-placeholder' }, { sel: '.nav-placeholder' }]);
    await badgesRefresh(dark); await snap(dark, 'A-H02-b-oscuro-vista-previa.png', r, 80);
    await dark.context().close();
  });

  await step('H03', async () => {
    await open(page, 'users');
    const r = await mark(page, [{ sel: '.sm-section button[aria-label="Actualizar"], .sm-section .um-refresh' , max: 1}, { sel: '.sm-section td.row-actions .icon-button', max: 1 }]);
    log.H03 = await page.evaluate(() => [...document.querySelectorAll('.sm-section button')].filter((b) => !b.innerText.trim()).map((b) => b.getAttribute('aria-label')));
    await badgesRefresh(page); await snap(page, 'A-H03-usuarios-nombres-accesibles.png', r, 80);
  });

  await step('H04', async () => {
    await open(page, 'account-security');
    await page.focus('#settings-section-title').catch(() => {});
    await page.keyboard.press('Tab');
    log.H04a = await page.evaluate(() => ({ id: document.activeElement?.id, tag: document.activeElement?.tagName }));
    await snap(page, 'A-H04-a-primer-foco-contrasena-actual.png', null, 0, true);
    await open(page, 'my-profile');
    log.H04b = await tabTo(page, 'avatar-file');
    let r = await mark(page, [{ sel: 'vx-file-button.p-identity__photo', quiet: true }], { scroll: false });
    await badgesRefresh(page); await snap(page, 'A-H04-b-foco-visible-subir-foto.png', r, 60);
    await open(page, 'branding');
    log.H04c = await tabTo(page, 'logoFile');
    r = await mark(page, [{ sel: '.logo-actions vx-file-button', quiet: true }], { scroll: false });
    await badgesRefresh(page); await snap(page, 'A-H04-c-foco-visible-subir-logo.png', r, 60);
    await open(page, 'fiscal');
    log.H04d = await tabTo(page, 'cert-file', 120);
    r = await mark(page, [{ sel: '.certificate-form vx-file-button', quiet: true }], { scroll: false });
    await badgesRefresh(page); await snap(page, 'A-H04-d-foco-visible-certificado.png', r, 60);
    // Los dos casos que la detección automática marca sin anillo: el anillo lo pinta el contenedor.
    await open(page, 'default-accounts');
    log.H04e = await tabTo(page, 'ss-defaultAccountsReceivableId', 120);
    r = await mark(page, [{ sel: 'vx-select:has(#ss-defaultAccountsReceivableId)', quiet: true }], { scroll: false });
    await badgesRefresh(page); await snap(page, 'A-H04-e-foco-visible-selector-de-cuenta.png', r, 60);
    await open(page, 'billing');
    log.H04f = await tabUntil(page, () => !!document.activeElement?.matches('.plan-card__input'), 80);
    r = await mark(page, [{ sel: '.plan-card:has(.plan-card__input:focus)', quiet: true }]);
    await badgesRefresh(page); await snap(page, 'A-H04-f-foco-visible-plan.png', r, 60);
  });

  await step('H05', async () => {
    await open(page, 'ai');
    await page.locator('#pol-monthly').fill('1234');
    await page.waitForTimeout(500);
    let r = await mark(page, [{ sel: '#pol-monthly' }, { sel: '.ssb' }], { scroll: false });
    await page.locator('#pol-monthly').scrollIntoViewIfNeeded();
    await badgesRefresh(page); await snap(page, 'A-H05-a-ia-barra-de-guardado.png', r, 0, true);
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    log.H05 = { question: await dialogText(page) };
    await snap(page, 'A-H05-b-ia-escape-pregunta.png', null, 0, true);
    await page.getByRole('button', { name: /Descartar/ }).last().click().catch(() => {});
    await closeClean(page);
  });

  await step('H06', async () => {
    await open(page, 'account-security');
    log.H06a = await page.evaluate(() => [...document.querySelectorAll('.sm-section button')].filter((b) => /primary/.test(b.className) && b.getBoundingClientRect().height).map((b) => b.innerText.trim()));
    let r = await mark(page, [{ sel: '.sm-section .sec-btn, .sm-section .pf-btn-secondary', max: 4 }]);
    await badgesRefresh(page); await snap(page, 'A-H06-a-seguridad-sin-primarias-duplicadas.png', null, 0, true);
    await open(page, 'subsidiaries');
    r = await mark(page, [{ text: 'Crear primera subsidiaria' }]);
    log.H06b = await page.evaluate(() => [...document.querySelectorAll('.sm-page__actions button')].map((b) => b.innerText.trim()));
    await badgesRefresh(page); await snap(page, 'A-H06-b-estructura-una-primaria.png', r, 0, true);
  });

  await step('H07', async () => {
    await open(page, 'account-security');
    log.H07a = await page.evaluate(() => [...document.querySelectorAll('.sm-section h2, .sm-section h3')].map((h) => `${h.tagName} ${getComputedStyle(h).fontSize} ${h.innerText.trim()}`));
    let r = await mark(page, [{ sel: '.sm-section h2', max: 4 }], { scroll: false });
    await badgesRefresh(page); await snap(page, 'A-H07-a-titulos-de-grupo-iguales.png', null, 0, true);
    await open(page, 'default-accounts');
    log.H07b = await page.evaluate(() => [...document.querySelectorAll('.sm-section h2, .sm-section h3')].slice(0, 6).map((h) => `${h.tagName} ${getComputedStyle(h).fontSize} ${h.innerText.trim()}`));
    r = await mark(page, [{ sel: '.sm-section h2', max: 1 }, { sel: '.sm-section h3', max: 2 }], { scroll: false });
    await badgesRefresh(page); await snap(page, 'A-H07-b-grupo-h2-subgrupo-h3.png', null, 0, true);
    await open(page, 'my-profile');
    log.H07c = await page.evaluate(() => [...document.querySelectorAll('.sm-panel h1')].map((h) => h.innerText.trim()));
    r = await mark(page, [{ sel: '.p-identity__name' }]);
    await badgesRefresh(page); await snap(page, 'A-H07-c-un-solo-h1.png', r, 90);
  });

  await step('H08', async () => {
    for (const [id, name] of [['my-profile', 'a-mi-perfil'], ['profile', 'b-perfil-empresa'], ['account-security', 'c-seguridad'], ['billing', 'd-facturacion']]) {
      await open(page, id);
      await snap(page, `A-H08-${name}-sin-tarjetas.png`, null, 0, true);
    }
  });

  await step('H09', async () => {
    for (const [id, act, name] of [
      ['security', async () => page.locator('.sm-section input[type="checkbox"]').first().click(), 'politica'],
      ['fiscal', async () => page.locator('.mode-choice', { hasText: 'Solo tradicionales' }).click(), 'fiscal'],
    ]) {
      await open(page, id);
      await act(); await page.waitForTimeout(500);
      const r = await mark(page, [{ sel: '.ssb' }], { scroll: false });
      await badgesRefresh(page); await snap(page, `A-H09-${name}-barra-de-guardado.png`, r, 0, true);
      await page.keyboard.press('Escape'); await page.waitForTimeout(600);
      await page.getByRole('button', { name: /Descartar/ }).last().click().catch(() => {});
      await closeClean(page);
    }
  });

  await step('H10', async () => {
    await open(page, 'sso');
    let r = await mark(page, [{ sel: '.sm-section vx-empty-state', max: 2 }]);
    await badgesRefresh(page); await snap(page, 'A-H10-a-sso-un-solo-vacio.png', r, 40);
    await open(page, 'audit-trail');
    // La empresa ya tiene acciones de personas: se filtra por una acción que no ha ocurrido para
    // ver el vacío común con su salida («Quitar filtros»).
    await page.locator('#sec-action').click();
    await page.locator('#sec-action').fill('Elimin');
    await page.waitForTimeout(500);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    log.H10b = await page.evaluate(() => document.querySelector('.sm-section vx-empty-state')?.innerText.replace(/\s+/g, ' ').trim() || 'con registros');
    r = await mark(page, [{ sel: '.sm-section vx-empty-state' }]);
    await badgesRefresh(page); await snap(page, 'A-H10-b-pista-de-auditoria.png', r, 80);
    await open(page, 'extensions');
    r = await mark(page, [{ sel: '.sm-section vx-empty-state' }]);
    await badgesRefresh(page); await snap(page, 'A-H10-c-extensiones-vacio-comun.png', r, 40);
  });

  await step('H11', async () => {
    await open(page, 'users');
    let r = await mark(page, [{ sel: '.sm-section vx-badge', max: 1 }]);
    await badgesRefresh(page); await snap(page, 'A-H11-a-activo-ok-usuarios.png', r, 90);
    await open(page, 'billing');
    r = await mark(page, [{ sel: '.summary vx-badge', max: 1 }]);
    await badgesRefresh(page); await snap(page, 'A-H11-b-activa-ok-facturacion.png', r, 90);
    await open(page, 'fiscal');
    r = await mark(page, [{ sel: '.issue-state vx-notice' }]);
    await badgesRefresh(page); await snap(page, 'A-H11-c-aviso-comun-fiscal.png', r, 30);
    await open(page, 'smtp');
    r = await mark(page, [{ sel: 'vx-notice' }]);
    await badgesRefresh(page); await snap(page, 'A-H11-d-aviso-comun-correo.png', r, 30);
  });

  await step('H12', async () => {
    await open(page, 'ai');
    const r = await mark(page, [{ text: 'El motor de análisis está detenido' }]);
    log.H12 = await page.evaluate(() => (document.querySelector('.sm-panel').innerText.match(/\[\[[^\]]+\]\]/g) || []));
    await badgesRefresh(page); await snap(page, 'A-H12-ia-sin-clave-cruda.png', r, 160);
  });

  await step('H13', async () => {
    await open(page, 'preferences');
    let r = await mark(page, [{ text: 'Se guarda en tu cuenta' }, { text: 'Se guarda en este equipo' }]);
    await badgesRefresh(page); await snap(page, 'A-H13-ab-preferencias-dice-donde-se-guarda.png', null, 0, true);
    r = await mark(page, [{ sel: '.language-selector .description' }]);
    await badgesRefresh(page); await snap(page, 'A-H13-c-una-sola-ayuda-idioma.png', r, 80);
    await open(page, 'security');
    r = await mark(page, [{ text: 'Exige a cada miembro' }, { text: 'Al activarlo' }]);
    await badgesRefresh(page); await snap(page, 'A-H13-d-politica-sin-repeticion.png', r, 60);
    await open(page, 'approvals');
    r = await mark(page, [{ sel: '.sm-section vx-empty-state' }]);
    await badgesRefresh(page); await snap(page, 'A-H13-e-aprobaciones-titulo-y-cuerpo-distintos.png', r, 40);
  });

  await step('H14', async () => {
    await open(page, 'fiscal');
    const r = await mark(page, [{ sel: '.issue-state__action', max: 3 }]);
    log.H14 = await page.evaluate(() => document.querySelector('.issue-state')?.innerText.replace(/\s+/g, ' ').trim());
    await badgesRefresh(page); await snap(page, 'A-H14-nombres-reales-y-enlaces.png', r, 120);
  });

  await step('H15', async () => {
    await open(page, 'roles');
    let r = await mark(page, [{ sel: '.sm-section td.row-actions', max: 2 }]);
    await badgesRefresh(page); await snap(page, 'A-H15-a-roles-acciones-de-fila.png', r, 60);
    await open(page, 'users');
    r = await mark(page, [{ sel: '.sm-section td.row-actions', max: 1 }]);
    await badgesRefresh(page); await snap(page, 'A-H15-b-usuarios-acciones-de-fila.png', r, 60);
    await page.locator('.sm-section td.row-actions [aria-haspopup="menu"]').first().click();
    await page.waitForTimeout(500);
    await snap(page, 'A-H15-c-menu-de-fila-compartido.png', null, 0, true);
    await page.keyboard.press('Escape');
    await open(page, 'preferences');
    r = await mark(page, [{ sel: '.button-group', max: 4 }]);
    await badgesRefresh(page); await snap(page, 'A-H15-d-segmentados-iguales.png', null, 0, true);
  });

  await step('H16', async () => {
    const phone = await ctxPage(browser, { viewport: { width: 390, height: 844 }, mobile: true });
    await open(phone, 'users');
    await snap(phone, 'A-H16-a-movil-usuarios.png', null, 0, true);
    await open(phone, 'roles');
    await snap(phone, 'A-H16-b-movil-roles.png', null, 0, true);
    await phone.context().close();
  });

  await step('H17', async () => {
    await open(page, 'account-security');
    await page.evaluate(() => { document.querySelector('.sm-content').scrollTop = 400; });
    await page.waitForTimeout(300);
    await snap(page, 'A-H17-separacion-uniforme.png', null, 0, true);
  });

  await step('H18', async () => {
    await open(page, 'account-security');
    let r = await mark(page, [{ sel: 'vx-settings-disclosure', max: 1 }]);
    await badgesRefresh(page); await snap(page, 'A-H18-a-desplegable-alineado.png', r, 90);
    await open(page, 'audit-trail');
    r = await mark(page, [{ sel: '.sec__period' }]);
    await badgesRefresh(page); await snap(page, 'A-H18-b-desde-y-hasta-juntos.png', r, 50);
    await open(page, 'ai');
    r = await mark(page, [{ sel: '.pol__fields' }]);
    await badgesRefresh(page); await snap(page, 'A-H18-c-ayudas-alineadas-ia.png', r, 50);
  });

  await step('H19', async () => {
    await open(page, 'branding');
    log.H19 = await page.evaluate(() => ({ inert: document.querySelector('app-live-preview')?.hasAttribute('inert'), focusable: [...document.querySelectorAll('app-live-preview button, app-live-preview input')].map((e) => e.tabIndex) }));
    const r = await mark(page, [{ sel: 'app-live-preview' }]);
    await badgesRefresh(page); await snap(page, 'A-H19-vista-previa-inerte.png', r, 40);
  });

  await step('H20', async () => {
    await open(page, 'extensions');
    const r = await mark(page, [{ sel: '.sm-page__actions' }], { scroll: false });
    await badgesRefresh(page); await snap(page, 'A-H20-acciones-en-la-cabecera.png', r, 60);
  });

  await step('H21', async () => {
    await open(page, 'ai');
    let r = await mark(page, [{ sel: '.pol__spent' }]);
    await badgesRefresh(page); await snap(page, 'A-H21-a-moneda-ia.png', r, 60);
    await open(page, 'billing');
    r = await mark(page, [{ sel: '.plan-price' }]);
    await badgesRefresh(page); await snap(page, 'A-H21-b-moneda-facturacion.png', r, 80);
  });

  await step('H22', async () => {
    await open(page, 'billing');
    let r = await mark(page, [{ sel: '.summary__label', max: 2 }]);
    await badgesRefresh(page); await snap(page, 'A-H22-a-sin-mayusculas.png', r, 60);
    r = await mark(page, [{ sel: '.usage-list' }]);
    log.H22 = await page.evaluate(() => getComputedStyle(document.querySelector('.usage-item__value')).fontVariantNumeric);
    await badgesRefresh(page); await snap(page, 'A-H22-b-consumo-estilo-oracion-y-cifras.png', r, 30);
  });

  await step('H23', async () => {
    await open(page, 'fiscal');
    let r = await mark(page, [{ sel: '.range-form .required', max: 3 }]);
    log.H23 = await page.evaluate(() => [...new Set([...document.querySelectorAll('.sm-section .required')].map((e) => getComputedStyle(e).color))]);
    await badgesRefresh(page); await snap(page, 'A-H23-a-obligatorio-uniforme.png', r, 60);
    await open(page, 'sso');
    r = await mark(page, [{ sel: '.sso-add' }]);
    await badgesRefresh(page); await snap(page, 'A-H23-b-etiqueta-visible-sso.png', r, 40);
    await open(page, 'my-profile');
    r = await mark(page, [{ sel: '#phone' }, { sel: '#jobtitle' }]);
    await badgesRefresh(page); await snap(page, 'A-H23-c-anchos-por-dato.png', r, 60);
  });

  await step('H24', async () => {
    await open(page, 'sso');
    await page.getByRole('button', { name: 'Agregar dominio' }).click();
    await page.waitForTimeout(400);
    const r = await mark(page, [{ sel: '.sso-add' }]);
    log.H24 = await page.evaluate(() => document.querySelector('.sso-error')?.innerText.trim());
    await badgesRefresh(page); await snap(page, 'A-H24-dominio-dice-que-falta.png', r, 40);
  });

  await step('H25', async () => {
    await open(page, 'my-profile');
    await page.fill('#settings-search', 'firma');
    await page.waitForTimeout(500);
    await snap(page, 'A-H25-buscador-firma.png', null, 0, true);
    await page.fill('#settings-search', '');
  });

  await step('H26', async () => {
    await open(page, 'integrations');
    await snap(page, 'A-H26-a-integraciones-sin-duplicados.png', null, 0, true);
    await open(page, 'ai');
    await page.evaluate(() => { const c = document.querySelector('.sm-content'); c.scrollTop = c.scrollHeight; });
    await page.waitForTimeout(300);
    const r = await mark(page, [{ text: 'Abrir la actividad de la IA' }], { scroll: false });
    await badgesRefresh(page); await snap(page, 'A-H26-b-ia-enlaza-la-actividad.png', null, 0, true);
    await page.goto(L.BASE + '/e/virtex-dev/reports/ai-activity', { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1500);
    await snap(page, 'A-H26-c-actividad-de-la-ia-en-analisis.png', null, 0, true);
  });

  // ── Reevaluación: defectos que solo aparecían en el teléfono, y Roles ──────────────────────────
  await step('R01', async () => {
    const phone = await ctxPage(browser, { viewport: { width: 390, height: 844 }, mobile: true });
    await open(phone, 'preferences');
    let r = await mark(phone, [{ sel: '.sm-section input[type="checkbox"]', max: 1 }]);
    log.R01 = await phone.evaluate(() => [...document.querySelectorAll('.sm-section input[type="checkbox"]')].slice(0, 1).map((e) => { const b = e.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}`; }));
    await badgesRefresh(phone); await snap(phone, 'A-R01-a-casilla-24px-preferencias.png', null, 0, true);
    await open(phone, 'ai');
    await phone.evaluate(() => { const c = document.querySelector('.sm-content'); c.scrollTop = 900; });
    await phone.waitForTimeout(300);
    log.R01b = await phone.evaluate(() => [...new Set([...document.querySelectorAll('.sm-section input[type="checkbox"]')].map((e) => { const b = e.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}`; }))]);
    await snap(phone, 'A-R01-b-casillas-24px-ia.png', null, 0, true);
    await phone.context().close();
  });

  await step('R02', async () => {
    const phone = await ctxPage(browser, { viewport: { width: 390, height: 844 }, mobile: true });
    await open(phone, 'users');
    const r = await mark(phone, [{ sel: '.um-segmented' }]);
    log.R02 = await phone.evaluate(() => { const g = document.querySelector('.um-segmented'); return [...g.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().width)); });
    await badgesRefresh(phone); await snap(phone, 'A-R02-segmentado-ordenado-usuarios.png', null, 0, true);
    await phone.context().close();
  });

  await step('R03', async () => {
    const phone = await ctxPage(browser, { viewport: { width: 390, height: 844 }, mobile: true });
    await open(phone, 'my-profile');
    await phone.locator('#lastname').scrollIntoViewIfNeeded();
    await phone.evaluate(() => { const c = document.querySelector('.sm-content'); c.scrollTop += 120; });
    await phone.waitForTimeout(300);
    log.R03 = await phone.evaluate(() => {
      const box = (s) => document.querySelector(s)?.getBoundingClientRect();
      const gap = (a, b) => Math.round(box(b).top - box(a).bottom);
      return { nombreApellidos: gap('#firstname', 'label[for="lastname"]'), apellidosCorreo: gap('#lastname', 'label[for="email"]'), cargoIdioma: gap('#jobtitle', 'label[for="preferredlanguage"]'), anchoIdioma: Math.round(box('#preferredlanguage').width), anchoCargo: Math.round(box('#jobtitle').width) };
    });
    await snap(phone, 'A-R03-espaciado-uniforme-mi-perfil.png', null, 0, true);
    await phone.context().close();
  });

  await step('R04', async () => {
    await open(page, 'roles');
    let r = await mark(page, [{ sel: '.sm-section td.row-actions .link-button', max: 2 }]);
    log.R04 = await page.evaluate(() => [...document.querySelectorAll('.sm-section td.row-actions .link-button')].map((b) => `${b.innerText.trim()} · ${b.getAttribute('aria-label')} · aria-disabled=${b.getAttribute('aria-disabled')}`));
    await badgesRefresh(page); await snap(page, 'A-R04-a-roles-ver-en-lugar-de-editar.png', r, 60);
    await unmark(page);
    await page.locator('.sm-section td.row-actions .link-button').first().click();
    await page.waitForTimeout(700);
    log.R04b = await dialogText(page);
    await snap(page, 'A-R04-b-rol-del-sistema-en-solo-lectura.png', null, 0, true);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    const phone = await ctxPage(browser, { viewport: { width: 390, height: 844 }, mobile: true });
    await open(phone, 'roles');
    await snap(phone, 'A-R04-c-movil-roles-ver.png', null, 0, true);
    await phone.context().close();
  });

  await step('R05', async () => {
    await open(page, 'audit-trail');
    // Con las acciones del sistema hay registros que paginar.
    await page.locator('.sm-section input[type="checkbox"]').first().uncheck().catch(() => {});
    await page.waitForTimeout(1200);
    let r = await mark(page, [{ sel: '.sm-section vx-pager' }]);
    log.R05 = await page.evaluate(() => document.querySelector('.sm-section vx-pager')?.innerText.replace(/\s+/g, ' ').trim());
    await badgesRefresh(page); await snap(page, 'A-R05-a-pista-paginacion-comun.png', r, 50);
    const phone = await ctxPage(browser, { viewport: { width: 390, height: 844 }, mobile: true });
    await open(phone, 'audit-trail');
    await phone.evaluate(() => { const c = document.querySelector('.sm-content'); c.scrollTop = c.scrollHeight; });
    await phone.waitForTimeout(400);
    await snap(phone, 'A-R05-b-movil-registro-y-paginacion.png', null, 0, true);
    await phone.context().close();
  });

  await step('R06', async () => {
    await open(page, 'roles');
    await page.locator('.sm-page__actions .primary-button').click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Guardar' }).last().click();
    await page.waitForTimeout(500);
    log.R06 = await page.evaluate(() => ({ nameError: document.querySelector('#role-name-error')?.innerText.trim() || null, permissionsError: document.querySelector('#role-permissions-error')?.innerText.trim() || null, focused: document.activeElement?.id || null }));
    await snap(page, 'A-R06-crear-rol-dice-que-falta.png', null, 0, true);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  });

  fs.writeFileSync(path.join(OUT, 'after-log.json'), JSON.stringify(log, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
