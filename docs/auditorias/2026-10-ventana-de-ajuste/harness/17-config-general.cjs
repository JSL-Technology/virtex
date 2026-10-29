const fs = require('fs');
const { launch, instrument, uiLogin, snap, go } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v)}`);
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page); await go(page, 'overview');
  const t0 = Date.now();
  await page.evaluate(() => { location.hash = 'settings/my-profile'; }); await page.locator('.sm-panel').waitFor();
  out('apertura ms', Date.now() - t0);
  const modal = page.locator('.sm-panel');
  const panelBox = await modal.boundingBox(); out('tamaño modal 1440x900', panelBox);
  const navs = await modal.locator('.nav-link').evaluateAll((els) => els.map((e) => e.innerText.trim()));
  out('secciones', navs.length);
  const rows = [];
  for (let i = 0; i < navs.length; i++) {
    for (let k = 0; k < 3 && await page.locator('.cdk-overlay-container [role=dialog], .cdk-overlay-container [role=alertdialog]').count(); k++) {
      const tarde = (await page.locator('.cdk-overlay-container [role=dialog], .cdk-overlay-container [role=alertdialog]').last().innerText()).slice(0, 300);
      if (rows.length) rows[rows.length - 1].dialogoTardio = tarde;
      await snap(page, `C-dialogo-tardio-${i - 1}`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(800);
      if (!(await page.locator('.sm-panel').count())) { await page.evaluate(() => { location.hash = 'settings/my-profile'; }); await page.locator('.sm-panel').waitFor(); }
    }
    const nc = log.console.length; const nr = log.requests.length;
    const t = Date.now();
    await modal.locator('.nav-link').nth(i).click();
    await page.waitForTimeout(2200);
    let dialogo = null;
    if (await page.locator('.cdk-overlay-container [role=dialog], .cdk-overlay-container [role=alertdialog]').count()) {
      dialogo = (await page.locator('.cdk-overlay-container [role=dialog], .cdk-overlay-container [role=alertdialog]').last().innerText()).slice(0, 300);
      await snap(page, `C-dialogo-al-entrar-${i}`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(800);
      out('estado tras Escape en diálogo de sección ' + navs[i], { url: page.url(), modalAbierto: await page.locator('.sm-panel').count() });
      if (!(await page.locator('.sm-panel').count())) { await page.evaluate(() => { location.hash = 'settings/my-profile'; }); await page.locator('.sm-panel').waitFor(); }
    }
    const info = await modal.evaluate((m) => {
      const content = m.querySelector('.sm-content') || m;
      const h1 = content.querySelector('h1, h2:not(.group-title)');
      const btns = [...content.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.innerText.trim()).filter(Boolean);
      const txt = content.innerText;
      const rawKeys = (txt.match(/\b[a-z_]+\.[a-z_]+(\.[a-z_]+)+\b/g) || []).slice(0, 5);
      const english = (txt.match(/\b(Save|Cancel|Settings|Loading|Delete|Edit|Add|Enabled|Disabled|Error|Submit|Search|None)\b/g) || []).slice(0, 5);
      const h1s = h1 ? getComputedStyle(h1) : null;
      const saveBtns = btns.filter((b) => /Guardar|Aplicar|Actualizar|Save/i.test(b));
      const inputs = content.querySelectorAll('input:not([type=hidden]), select, textarea').length;
      const unlabeled = [...content.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea')].filter((e) => !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).length;
      const help = content.querySelectorAll('.help, .hint, small, .field-hint, [class*=help], [class*=description]').length;
      return { titulo: h1 ? h1.innerText.trim().slice(0, 60) : '(sin título)', h1: h1s ? `${h1s.fontSize}/${h1s.fontWeight}` : '-', guardar: saveBtns, botones: btns.slice(0, 8), inputs, unlabeled, ayudas: help, rawKeys, english, vacio: txt.trim().length < 40, len: txt.length };
    });
    const nuevos = log.requests.slice(nr).filter((r) => typeof r.status === 'number' && r.status >= 400).map((r) => `${r.method} ${r.url} ${r.status}`);
    rows.push({ dialogo, nav: navs[i], ms: Date.now() - t, ...info, errRed: nuevos, errConsola: log.console.slice(nc).slice(0, 2) });
    if ([0, 3, 6, 8, 9, 12, 15, 18, 21].includes(i)) await snap(page, `9${i < 10 ? '0' + i : i}-cfg-${navs[i].replace(/[^a-zA-Záéíóúñ]+/g, '-').slice(0, 24)}`.replace(/^9/, 'C'));
  }
  fs.writeFileSync(__dirname + '/../config-secciones.json', JSON.stringify(rows, null, 1));
  for (const r of rows) console.log(`${r.nav.padEnd(28)} | ${r.titulo.padEnd(34)} | h1 ${r.h1} | guardar=${JSON.stringify(r.guardar)} | in=${r.inputs} sinEtq=${r.unlabeled} ayudas=${r.ayudas} | raw=${r.rawKeys} en=${r.english} | red=${r.errRed} | ${r.ms}ms ${r.dialogoTardio ? '| DIALOGO TARDIO: ' + r.dialogoTardio.replace(/\n+/g, ' / ') : ''} ${r.dialogo ? '| DIALOGO: ' + r.dialogo.replace(/\n+/g, ' / ') : ''}`);
  // Mezcla de modelos de guardado: buscar toggles que guardan solos (PATCH al cambiar)
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
