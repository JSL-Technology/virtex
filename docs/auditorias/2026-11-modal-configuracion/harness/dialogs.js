// Diálogos de la modal (Roles y Usuarios): axe sobre el diálogo abierto, foco atrapado, Escape que
// cierra solo el diálogo y foco inicial. Con --before captura el estado anterior (marcas en rojo).
// Uso: node dialogs.js [--before] [--only=roles,users]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const L = require('./after-lib.js');
const AXE = fs.readFileSync(path.join(__dirname, '../../../../node_modules/axe-core/axe.min.js'), 'utf8');
const BEFORE = process.argv.includes('--before');
const ONLY = ((process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || 'roles,users').split(',');
const OUT = BEFORE ? path.join(L.ROOT, 'reeval-before-dialogs') : L.OUT;
fs.mkdirSync(OUT, { recursive: true });
const results = {};

const PANEL = '.vx-dialog__panel, .modal-content[role="dialog"], .modal-content[role="alertdialog"]';
async function dialogOpen(page) {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)].some((d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== 'hidden'; }), PANEL);
}
async function axeDialog(page) {
  await page.evaluate(AXE);
  return page.evaluate(async (sel) => {
    const target = [...document.querySelectorAll(sel)].find((d) => d.getBoundingClientRect().width > 0);
    if (!target) return [{ id: 'no-dialog' }];
    const r = await window.axe.run(target, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, count: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  }, PANEL);
}
async function focusTrapped(page, presses = 25) {
  const escapes = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate((sel) => { const a = document.activeElement; return !!a && !!a.closest(sel); }, PANEL);
    if (!inside) escapes.push(await page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''} «${(a.getAttribute('aria-label') || a.innerText || '').trim().slice(0, 30)}»` : 'body'; }));
  }
  return { presses, escapes: escapes.length, sample: escapes.slice(0, 3) };
}
async function activeId(page) {
  return page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : null; });
}
async function markRed(page, sels) {
  await page.evaluate((sels) => {
    if (!document.getElementById('__hlr-style')) {
      const s = document.createElement('style'); s.id = '__hlr-style';
      s.textContent = '.__hlr{outline:3px solid #e5484d !important;outline-offset:3px !important;} .__hlr-badge{position:fixed;z-index:2147483647;background:#e5484d;color:#fff;font:700 12px/20px system-ui;min-width:20px;height:20px;border-radius:10px;text-align:center;padding:0 5px;pointer-events:none;box-shadow:0 0 0 2px #fff}';
      document.head.appendChild(s);
    }
    document.querySelectorAll('.__hlr-badge').forEach((b) => b.remove());
    document.querySelectorAll('.__hlr').forEach((e) => e.classList.remove('__hlr'));
    sels.forEach((sel, i) => {
      [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0).slice(0, 3).forEach((el) => {
        el.classList.add('__hlr');
        const r = el.getBoundingClientRect();
        const b = document.createElement('div'); b.className = '__hlr-badge'; b.textContent = String(i + 1);
        b.style.left = Math.max(0, r.left - 14) + 'px'; b.style.top = Math.max(0, r.top - 14) + 'px';
        document.body.appendChild(b);
      });
    });
  }, sels);
}
async function shot(page, name) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('shot', name);
}
async function settingsStillOpen(page) {
  return page.evaluate(() => !!document.querySelector('.sm-panel'));
}

(async () => {
  const browser = await chromium.launch();
  const page = await L.ctxPage(browser);

  if (ONLY.includes('roles')) {
    await L.open(page, 'roles');
    const r = {};
    if (BEFORE) {
      await markRed(page, ['.sm-section td.row-actions .link-button']);
      await shot(page, 'B-R04-roles-editar-deshabilitado.png');
    }
    // Crear: foco inicial, guardar vacío, axe, foco atrapado, Escape.
    await page.locator('.sm-page__actions .primary-button').click();
    await page.waitForTimeout(700);
    r.createInitialFocus = await activeId(page);
    r.createAxe = await axeDialog(page);
    r.saveDisabledWhenEmpty = await page.evaluate(() => { const b = [...document.querySelectorAll('.vx-dialog__panel button')].find((x) => /Guardar/.test(x.innerText)); return b ? b.disabled : null; });
    if (BEFORE) {
      await markRed(page, ['.permission-group h4', '.vx-dialog__panel button[disabled]']);
      await shot(page, 'B-R06-crear-rol-antes.png');
    } else {
      await page.getByRole('button', { name: 'Guardar' }).last().click();
      await page.waitForTimeout(400);
      r.createErrors = await page.evaluate(() => [...document.querySelectorAll('#role-name-error, #role-permissions-error')].map((e) => e.innerText.trim()));
    }
    r.createTrap = await focusTrapped(page);
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    r.createEscapeClosesOnlyDialog = !(await dialogOpen(page)) && (await settingsStillOpen(page));
    if (!BEFORE) {
      // Ver un rol del sistema: solo lectura.
      await page.locator('.sm-section td.row-actions .link-button').first().click();
      await page.waitForTimeout(700);
      r.viewAxe = await axeDialog(page);
      r.viewTrap = await focusTrapped(page);
      await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      r.viewEscapeClosesOnlyDialog = !(await dialogOpen(page)) && (await settingsStillOpen(page));
    }
    results.roles = r;
  }

  if (ONLY.includes('users')) {
    await L.open(page, 'users');
    const u = {};
    await page.locator('.sm-page__actions .primary-button').click();
    await page.waitForTimeout(700);
    u.inviteInitialFocus = await activeId(page);
    u.inviteAxe = await axeDialog(page);
    if (BEFORE) {
      await markRed(page, ['.modal-close', '.modal-footer .btn', '.modal-body .form-label']);
      await shot(page, 'B-R07-a-invitar-usuario-antes.png');
    } else {
      await shot(page, 'A-R07-a-invitar-usuario-dialogo-comun.png');
    }
    // Enviar vacío: cada campo dice qué le falta.
    await page.getByRole('button', { name: /Enviar invitación/ }).last().click();
    await page.waitForTimeout(500);
    u.inviteErrors = await page.evaluate(() => [...document.querySelectorAll('.vx-field-error, .field-error')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.innerText.trim()));
    await shot(page, BEFORE ? 'B-R07-b-invitar-errores-antes.png' : 'A-R07-b-invitar-dice-que-falta.png');
    u.inviteTrap = await focusTrapped(page);
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    u.inviteEscapeClosesOnlyDialog = !(await dialogOpen(page)) && (await settingsStillOpen(page));
    // Editar a la persona de la primera fila.
    await page.locator('.sm-section td.row-actions .link-button').first().click().catch(() => {});
    await page.waitForTimeout(700);
    u.editOpen = await dialogOpen(page);
    u.editAxe = u.editOpen ? await axeDialog(page) : null;
    if (u.editOpen) await shot(page, BEFORE ? 'B-R07-c-editar-usuario-antes.png' : 'A-R07-c-editar-usuario.png');
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    results.users = u;
  }

  const file = path.join(L.ROOT, 'results', BEFORE ? 'dialogs-before.json' : 'dialogs.json');
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
