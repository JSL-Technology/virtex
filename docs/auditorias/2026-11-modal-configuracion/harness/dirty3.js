// GUA-01: ningún cambio se pierde sin aviso. Para cada formulario de la modal: se cambia algo, se
// comprueba la barra de guardado (si el formulario guarda), se pulsa Escape y se espera la pregunta;
// «Seguir editando»/«Cancelar» conserva el valor; después «Descartar» cierra.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'salida');
const BASE = 'http://localhost:4200';
const STATE = path.join(__dirname, 'state.json');
const shot = (name) => { const p = path.join(ROOT, 'shots', 'dirty3', name); fs.mkdirSync(path.dirname(p), { recursive: true }); return p; };

const { CASES } = require('./gua-cases.js');

const dialogs = (p) => p.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((d) => !d.classList.contains('sm-panel') && !d.closest('.sm-panel')).map((d) => ({ text: d.innerText.replace(/\s+/g, ' ').trim().slice(0, 200), buttons: [...d.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean) })));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-DO', storageState: STATE });
  const page = await ctx.newPage();
  const R = {};
  const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
  const prev = ONLY && fs.existsSync(path.join(ROOT, 'results', 'dirty3.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'results', 'dirty3.json'), 'utf8')) : {};
  Object.assign(R, prev);
  for (const c of CASES.filter((x) => !ONLY || ONLY.split(',').includes(x.key || x.id))) {
    const key = c.key || c.id;
    const r = { label: c.label, saves: c.saves };
    try {
      await page.goto(BASE + '/e/virtex-dev/overview', { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(600);
      await page.evaluate((s) => { location.hash = '#settings/' + s; }, c.id);
      await page.waitForSelector('.sm-panel', { timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('.sm-section vx-spinner'), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);
      await c.act(page);
      await page.waitForTimeout(500);
      r.value = await c.read(page);
      r.saveBar = await page.evaluate(() => document.querySelector('.ssb')?.innerText.replace(/\s+/g, ' ').trim() || null);
      await page.screenshot({ path: shot(`${key}-1-con-cambios.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      r.question = await dialogs(page);
      r.modalOpenAfterEscape = !!(await page.$('.sm-panel'));
      await page.screenshot({ path: shot(`${key}-2-escape-pregunta.png`) });
      if (r.question.length) {
        const keep = r.question[0].buttons.find((b) => /seguir|cancelar/i.test(b));
        await page.getByRole('button', { name: keep, exact: true }).last().click();
        await page.waitForTimeout(500);
        r.valueKept = String(await c.read(page)) === String(r.value);
        // La X también pregunta; ahora se descarta.
        await page.locator('.sm-panel button[aria-label="Cerrar"], .sm-panel .sm-close, .sm-header button').first().click().catch(() => {});
        await page.waitForTimeout(600);
        const second = await dialogs(page);
        r.closeAsks = second.length > 0;
        if (second.length) {
          const discard = second[0].buttons.find((b) => /descartar/i.test(b));
          if (discard) await page.getByRole('button', { name: discard, exact: true }).last().click();
          await page.waitForTimeout(700);
        }
        r.closedAfterDiscard = !(await page.$('.sm-panel'));
      }
      r.verdict = r.question.length && r.modalOpenAfterEscape && r.valueKept && r.closeAsks && (!c.saves || !!r.saveBar) ? 'CUMPLE' : 'NO CUMPLE';
    } catch (e) {
      r.error = String(e).slice(0, 240);
      r.verdict = 'ERROR';
    }
    R[key] = r;
    console.log(`${key}: saveBar=${!!r.saveBar} asks=${!!(r.question && r.question.length)} kept=${r.valueKept} closeAsks=${r.closeAsks} → ${r.verdict}${r.error ? ' ' + r.error : ''}`);
  }
  fs.writeFileSync(path.join(ROOT, 'results', 'dirty3.json'), JSON.stringify(R, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
