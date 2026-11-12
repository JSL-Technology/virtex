// GUA-01, los otros dos caminos de salida: con un cambio hecho, clic en el fondo (fuera del panel)
// y clic en otra página de la barra lateral. Cada uno debe preguntar, o no salir, y conservar lo
// escrito. Al final se descarta con la X: no se guarda nada. Complementa a dirty3.js (Escape y X).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { CASES } = require('./gua-cases.js');
const ROOT = path.join(__dirname, '..', 'salida');
const BASE = 'http://localhost:4200';
const STATE = path.join(__dirname, 'state.json');

const dialogs = (p) => p.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((d) => !d.classList.contains('sm-panel') && !d.closest('.sm-panel')).map((d) => ({ text: d.innerText.replace(/\s+/g, ' ').trim().slice(0, 160), buttons: [...d.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean) })));
const title = (p) => p.evaluate(() => document.querySelector('.sm-page__title')?.innerText.trim() || null);

/** Answer «keep editing» if a question is open; returns whether one was. */
async function keepEditing(page) {
  const q = await dialogs(page);
  if (!q.length) return false;
  const keep = q[0].buttons.find((b) => /seguir|cancelar/i.test(b));
  await page.getByRole('button', { name: keep, exact: true }).last().click();
  await page.waitForTimeout(500);
  return true;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-DO', storageState: STATE });
  const page = await ctx.newPage();
  const R = {};
  for (const c of CASES) {
    const key = c.key || c.id;
    const r = { label: c.label };
    try {
      await page.goto(BASE + '/e/virtex-dev/overview', { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(600);
      await page.evaluate((s) => { location.hash = '#settings/' + s; }, c.id);
      await page.waitForSelector('.sm-panel', { timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('.sm-section vx-spinner'), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);
      const before = await title(page);
      await c.act(page);
      await page.waitForTimeout(500);
      const value = String(await c.read(page));

      // 1. El fondo: fuera del panel de la modal.
      await page.mouse.click(8, 450);
      await page.waitForTimeout(700);
      r.backdropAsked = await keepEditing(page);
      r.backdropStillOpen = !!(await page.$('.sm-panel')) && (await title(page)) === before;
      r.backdropKept = r.backdropStillOpen && String(await c.read(page)) === value;

      // 2. Otra página de la barra lateral.
      const target = page.locator('.sm-nav .nav-link:not(.active):not([aria-current="page"])').first();
      r.navTarget = (await target.innerText()).trim();
      await target.click();
      await page.waitForTimeout(800);
      r.navAsked = await keepEditing(page);
      r.navStayed = (await title(page)) === before;
      r.navKept = r.navStayed && String(await c.read(page)) === value;

      // Descartar y cerrar, sin guardar.
      await page.locator('.sm-panel button[aria-label="Cerrar"], .sm-panel .sm-close, .sm-header button').first().click().catch(() => {});
      await page.waitForTimeout(600);
      const q = await dialogs(page);
      if (q.length) {
        const discard = q[0].buttons.find((b) => /descartar/i.test(b));
        if (discard) await page.getByRole('button', { name: discard, exact: true }).last().click();
        await page.waitForTimeout(600);
      }
      r.verdict = r.backdropKept && r.navAsked && r.navKept ? 'CUMPLE' : 'NO CUMPLE';
    } catch (e) {
      r.error = String(e).slice(0, 240);
      r.verdict = 'ERROR';
    }
    R[key] = r;
    console.log(`${key}: fondo=${r.backdropAsked ? 'pregunta' : r.backdropStillOpen ? 'no cierra' : 'CIERRA'} conserva=${r.backdropKept} · página «${r.navTarget}»=${r.navAsked ? 'pregunta' : 'NO PREGUNTA'} conserva=${r.navKept} → ${r.verdict}${r.error ? ' ' + r.error : ''}`);
  }
  fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'results', 'exits.json'), JSON.stringify(R, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
