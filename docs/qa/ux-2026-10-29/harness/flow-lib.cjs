const lib = require('./lib.cjs');
const SLUG = 'qa-ux3-comercializadora-nandu-hijos-s-a-de-c-v';
const panel = (page) => page.locator('.dv-groupview.dv-active-group .dv-content-container').first();
async function fields(page) {
  return panel(page).locator('input, select, textarea').evaluateAll(els => els.filter(e => e.offsetParent && e.type !== 'hidden').map(e => {
    const lab = (e.labels && e.labels[0] ? e.labels[0].innerText : '') || e.getAttribute('aria-label') || '';
    return `${e.tagName.toLowerCase()}/${e.type}|${lab.trim().replace(/\s+/g, ' ').slice(0, 45)}|ph=${e.placeholder || ''}|req=${e.required || e.getAttribute('aria-required') || ''}|inv=${e.getAttribute('aria-invalid')}|desc=${e.getAttribute('aria-describedby') || ''}|val=${e.tagName === 'SELECT' ? (e.selectedOptions[0]?.text || '') : (e.value || '').slice(0, 25)}${e.tagName === 'SELECT' ? '|opts=' + e.options.length : ''}`;
  }));
}
async function errors(page) {
  return page.evaluate(() => [...document.querySelectorAll('[role=alert], [class*=error], [class*=invalid-feedback], .toast, [class*=toast], [class*=snack]')].filter(e => e.offsetParent && !e.querySelector('select,input')).map(e => e.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i));
}
async function text(page) { return (await panel(page).innerText().catch(() => '')).replace(/\n{2,}/g, '\n'); }
async function go(page, path) { await page.goto(lib.BASE + '/e/' + SLUG + '/' + path); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1500); }
module.exports = { ...lib, SLUG, panel, fields, errors, text, go };
const MX = { email: 'qa.ux3.mx16@example.com', password: 'QA-Test-Pass-2026!' };
// Abre un contexto con sesión válida: reutiliza el estado guardado o inicia sesión, y lo guarda al terminar.
async function session(stateName, creds, opts = {}) {
  const fs = require('fs'); const f = __dirname + '/' + stateName;
  const { browser, context } = await lib.launch({ ...opts, storageState: fs.existsSync(f) ? f : undefined });
  const page = await context.newPage(); const log = lib.instrument(page);
  await page.goto(lib.BASE + '/'); await page.waitForTimeout(3000);
  if (page.url().includes('/auth/')) { await lib.login(page, creds); }
  const close = async () => { await context.storageState({ path: f }).catch(() => {}); await browser.close(); };
  return { browser, context, page, log, close };
}
module.exports.session = session; module.exports.MX = MX;
