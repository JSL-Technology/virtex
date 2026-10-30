// Recorre cada sección de Configuración: mide el layout y captura el primer pliegue y la sección completa.
const fs = require('fs');
const path = require('path');
const { launch, instrument, uiLogin, go } = require('./lib.cjs');
const DIR = path.resolve(__dirname, '../capturas/config');
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page); await go(page, 'overview');
  await page.evaluate(() => { location.hash = 'settings/my-profile'; }); await page.locator('.sm-panel').waitFor();
  const modal = page.locator('.sm-panel');
  const navs = await modal.locator('.nav-link').evaluateAll((els) => els.map((e) => e.innerText.trim()));
  const rows = [];
  for (let i = 0; i < navs.length; i++) {
    for (let k = 0; k < 3 && await page.locator('.cdk-overlay-container [role=dialog]').count(); k++) { await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
    if (!(await page.locator('.sm-panel').count())) { await page.evaluate(() => { location.hash = 'settings/my-profile'; }); await page.locator('.sm-panel').waitFor(); }
    const nr = log.requests.length;
    await modal.locator('.nav-link').nth(i).click();
    await page.waitForTimeout(2600);
    const stepUp = await page.locator('.cdk-overlay-container [role=dialog]').count();
    if (stepUp) { await page.keyboard.press('Escape'); await page.waitForTimeout(800); }
    const n = String(i + 1).padStart(2, '0');
    await page.screenshot({ path: `${DIR}/${n}-${slug(navs[i])}-pliegue.png` });
    const m = await page.evaluate(() => {
      const panel = document.querySelector('.sm-panel');
      const content = panel.querySelector('.sm-content') || panel.querySelector('.sm-body > :last-child');
      const scroller = [content, ...content.querySelectorAll('*')].find((e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 4; }) || content;
      const page = content.firstElementChild?.firstElementChild || content.firstElementChild;
      const cs = (e) => (e ? getComputedStyle(e) : null);
      const r = (e) => (e ? e.getBoundingClientRect() : null);
      const vis = (e) => e.offsetParent !== null && r(e).width > 0;
      const h1 = content.querySelector('h1') || content.querySelector('h2');
      const sub = h1 ? h1.parentElement.querySelector('p') : null;
      const inputs = [...content.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, [role=combobox]')].filter(vis);
      const checks = [...content.querySelectorAll('input[type=checkbox], input[type=radio], [role=switch]')].filter((e) => e.offsetParent !== null);
      const btns = [...content.querySelectorAll('button')].filter(vis);
      const primary = btns.filter((b) => /primary/.test(b.className) || cs(b).backgroundColor === 'rgb(91, 55, 217)');
      const contentRect = r(content);
      const lefts = [...new Set(inputs.map((e) => Math.round(r(e).left)))];
      const widths = [...new Set(inputs.map((e) => Math.round(r(e).width)))];
      const cards = [...content.querySelectorAll('[class*=card], section, fieldset, .s-section, .panel')].filter((e) => vis(e) && cs(e).borderTopWidth !== '0px' && r(e).height > 60);
      const tables = [...content.querySelectorAll('table')].filter(vis);
      const labels = [...content.querySelectorAll('label, .field-label, .form-label')].filter(vis);
      const lab = labels[0] ? cs(labels[0]) : null;
      const helpEls = [...content.querySelectorAll('small, .hint, .help, .field-hint, [class*=help], [class*=description], [class*=hint]')].filter(vis);
      const saves = btns.filter((b) => /Guardar|Actualizar|Aplicar/.test(b.innerText)).map((b) => ({ t: b.innerText.trim(), y: Math.round(r(b).top - contentRect.top + scroller.scrollTop), x: Math.round(r(b).left - contentRect.left), dis: b.disabled, cls: b.className.split(' ')[0] }));
      const sticky = [...content.querySelectorAll('*')].some((e) => ['sticky', 'fixed'].includes(cs(e).position));
      const pageCs = cs(page);
      const firstBlock = [...content.querySelectorAll('*')].find((e) => vis(e) && r(e).width > 200);
      return {
        titulo: h1?.innerText.trim().slice(0, 60), h1: h1 ? `${cs(h1).fontSize}/${cs(h1).fontWeight}` : null, subtitulo: sub?.innerText.trim().slice(0, 140) || null,
        contenidoAncho: Math.round(contentRect.width), paginaAncho: page ? Math.round(r(page).width) : null, maxWidth: pageCs?.maxWidth, padding: pageCs?.padding,
        margenDerechoLibre: page ? Math.round(contentRect.right - r(page).right) : null,
        alturaScroll: scroller.scrollHeight, alturaVisible: scroller.clientHeight, pantallas: +(scroller.scrollHeight / Math.max(scroller.clientHeight, 1)).toFixed(1),
        campos: inputs.length, casillas: checks.length, columnasCampos: lefts.length, anchosCampo: widths.slice(0, 6), alturasCampo: [...new Set(inputs.map((e) => Math.round(r(e).height)))],
        etiquetas: labels.length, etiqueta: lab ? `${lab.fontSize}/${lab.fontWeight} ${lab.color}` : null, ayudas: helpEls.length,
        tarjetas: cards.length, radioTarjeta: cards[0] ? cs(cards[0]).borderTopLeftRadius : null, tablas: tables.length, botones: btns.length, primarios: primary.map((b) => b.innerText.trim()).slice(0, 6),
        guardado: saves, pegajoso: sticky,
        textoLen: content.innerText.length,
        vacio: /no hay|todavía no|sin [a-z]+ (registrad|configurad)|aún no/i.test(content.innerText) ? (content.innerText.match(/[^\n]*(no hay|todavía no|aún no)[^\n]*/i) || [''])[0].slice(0, 120) : null,
      };
    });
    // captura de la sección completa: se libera la altura del modal solo para fotografiar
    await page.addStyleTag({ content: '.sm-panel{height:auto!important;max-height:none!important}.sm-body,.sm-content,.sm-content *{overflow:visible!important;max-height:none!important}:host,app-settings-modal{position:absolute!important}' }).then(async (h) => {
      await page.waitForTimeout(300);
      await modal.locator('.sm-content').screenshot({ path: `${DIR}/${n}-${slug(navs[i])}-completa.png` }).catch(() => {});
      await h.evaluate((el) => el.remove());
    });
    await page.waitForTimeout(300);
    const errs = log.requests.slice(nr).filter((x) => typeof x.status === 'number' && x.status >= 400).map((x) => `${x.method} ${x.url} ${x.status}`);
    rows.push({ n, nav: navs[i], stepUp: !!stepUp, errores: errs, ...m });
    console.log(n, navs[i], JSON.stringify({ t: m.titulo, ancho: [m.contenidoAncho, m.paginaAncho, m.maxWidth], pant: m.pantallas, campos: m.campos, cols: m.columnasCampos, tarj: m.tarjetas, tablas: m.tablas, guardado: m.guardado.map((s) => s.t + '@' + s.y), stepUp: !!stepUp }));
  }
  fs.writeFileSync(path.resolve(__dirname, '../config-layout.json'), JSON.stringify(rows, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
