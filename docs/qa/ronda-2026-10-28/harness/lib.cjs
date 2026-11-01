// Utilidades compartidas del arnés de QA E2E (Playwright contra el entorno local).
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW_PATH || 'playwright');

const BASE = process.env.QA_BASE || 'http://localhost:4200';
const API = process.env.QA_API || 'http://localhost:3000/api/v1';
const EVID = path.resolve(__dirname, '..', 'evidence');
const ADMIN = { email: 'dev@virtex.local', password: process.env.QA_PASS || 'QA-Test-Pass-2026' };

async function launch() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES', ignoreHTTPSErrors: true });
  // Las fuentes de Google no son alcanzables desde el contenedor: se abortan para que no bloqueen las capturas.
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  return { browser, context };
}

/** Registra toda llamada a la API y todo error de consola de una página. */
function instrument(page) {
  const log = { requests: [], console: [], pageErrors: [] };
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    const req = res.request();
    let body = '';
    if (res.status() >= 400) { try { body = (await res.text()).slice(0, 400); } catch {} }
    log.requests.push({ method: req.method(), url: url.replace(API, ''), status: res.status(), body });
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('/api/')) log.requests.push({ method: req.method(), url: req.url().replace(API, ''), status: 'FAILED', body: req.failure()?.errorText });
  });
  page.on('console', (m) => { if (m.type() === 'error') log.console.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => log.pageErrors.push(String(e).slice(0, 300)));
  return log;
}

async function uiLogin(page, creds = ADMIN) {
  await page.goto(`${BASE}/es/auth/login`, { waitUntil: 'load' });
  await page.locator('input[type=password]').first().waitFor({ timeout: 30000 });
  await page.locator('input[type=email], input[formcontrolname=email], input[name=email]').first().fill(creds.email);
  await page.locator('input[type=password]').first().fill(creds.password);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/auth/'), { timeout: 20000 });
  await page.waitForTimeout(1500);
}

async function shot(page, name) {
  fs.mkdirSync(EVID, { recursive: true });
  const f = path.join(EVID, `${name}.png`);
  await page.screenshot({ path: f, fullPage: false, timeout: 10000, animations: 'disabled' }).catch(() => {});
  return `evidence/${name}.png`;
}

module.exports = { BASE, API, ADMIN, EVID, launch, instrument, uiLogin, shot };

// ---- Helpers para flujos guiados ----
const ORG_SLUG = process.env.QA_ORG || 'virtex-dev';
const panel = (page) => page.locator('.dv-groupview.dv-active-group .dv-content-container');
async function go(page, p) {
  await page.evaluate((u) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }, `/e/${ORG_SLUG}/${p.replace(/^\//, '')}`);
  await page.waitForTimeout(1500);
}
/** Localiza el control asociado a una etiqueta visible dentro del panel activo. */
async function field(page, labelText) {
  const root = panel(page);
  const byLabel = root.getByLabel(labelText, { exact: false });
  if (await byLabel.count()) return byLabel.first();
  const handle = await root.evaluateHandle((rootEl, txt) => {
    const norm = (s) => s.replace(/\s+/g, ' ').replace(/\*/g, '').trim().toLowerCase();
    const labels = [...rootEl.querySelectorAll('label, .label, span, p, div')].filter((l) => l.childElementCount <= 2 && norm(l.innerText || '') === norm(txt));
    for (const l of labels) {
      let c = l;
      for (let k = 0; k < 4 && c; k++) {
        const ctl = c.querySelector('input, select, textarea, [role=combobox]');
        if (ctl) return ctl;
        c = c.parentElement;
      }
    }
    return null;
  }, labelText);
  const el = handle.asElement();
  if (!el) throw new Error(`campo no encontrado: ${labelText}`);
  return el;
}
async function fill(page, labelText, value) {
  const f = await field(page, labelText);
  const tag = await f.evaluate((e) => e.tagName.toLowerCase());
  if (tag === 'select') {
    const opts = await f.evaluate((e) => [...e.options].map((o) => ({ v: o.value, t: o.text.trim() })));
    const m = opts.find((o) => o.t === value) || opts.find((o) => o.t.toLowerCase().includes(String(value).toLowerCase())) || opts.find((o) => o.v === value);
    if (!m) throw new Error(`opción "${value}" no existe en ${labelText}: ${opts.map((o) => o.t).join(', ')}`);
    await f.selectOption(m.v);
  } else {
    await f.fill(String(value));
  }
  await page.waitForTimeout(200);
}
async function click(page, name, opts = {}) {
  const root = opts.global ? page : panel(page);
  const b = root.getByRole('button', { name, exact: !!opts.exact });
  if (await b.count()) { await b.first().click(); } else { await root.getByText(name, { exact: !!opts.exact }).first().click(); }
  await page.waitForTimeout(opts.wait || 1500);
}
const panelText = (page) => panel(page).innerText().catch(() => '');
function netSince(log, from = 0) { return log.requests.slice(from).filter((x) => !/me\/(workspace|jobs)|notifications|current-period|auth\/session/.test(x.url)).map((x) => `${x.method} ${x.url} ${x.status}${x.body ? ' ' + x.body.slice(0, 250) : ''}`); }
async function toasts(page) { return page.evaluate(() => [...document.querySelectorAll('[role=alert], [role=status], [class*=toast], [class*=snack]')].map((e) => e.innerText.trim()).filter(Boolean).join(' | ')); }
async function errorsShown(page) { if (!(await panel(page).count())) return ['(sin panel activo)']; return panel(page).evaluate((r) => [...r.querySelectorAll('[class*=error], [class*=invalid-feedback], .text-red, [role=alert], mat-error')].map((e) => e.innerText.trim()).filter(Boolean)); }
module.exports = Object.assign(module.exports, { go, field, fill, click, panel, panelText, netSince, toasts, errorsShown, ORG_SLUG });
/** Resuelve el diálogo de step-up si aparece. `wrongFirst` prueba antes una contraseña incorrecta. */
async function stepUp(page, { wrongFirst = false } = {}) {
  const pwd = page.getByPlaceholder('Ingresa tu contraseña actual').last();
  await pwd.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  if (!(await pwd.count())) return null;
  const out = {};
  if (wrongFirst) {
    await pwd.fill('incorrecta-123');
    await page.getByRole('button', { name: 'Confirmar' }).last().click();
    await page.waitForTimeout(1500);
    out.wrong = (await page.locator('body').innerText()).match(/(incorrect|inválid|no coincide|error)[^\n]{0,80}/i)?.[0] || 'sin mensaje visible';
  }
  await pwd.fill(process.env.STEPUP_PASS || ADMIN.password);
  await page.getByRole('button', { name: 'Confirmar' }).last().click();
  await page.waitForTimeout(2500);
  out.ok = true;
  return out;
}
module.exports.stepUp = stepUp;
/** Resuelve todos los diálogos de step-up apilados; devuelve cuántos hubo. */
async function stepUpAll(page) { let k = 0; for (; k < 4; k++) { const r = await stepUp(page); if (!r) break; } return k; }
module.exports.stepUpAll = stepUpAll;
