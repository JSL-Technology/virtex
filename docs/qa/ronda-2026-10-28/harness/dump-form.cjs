// Vuelca etiquetas, controles y botones de una o varias rutas (para escribir flujos).
const { launch, instrument, uiLogin, go, panel } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  instrument(page);
  await uiLogin(page);
  for (const r of process.argv.slice(2)) {
    await go(page, r); await page.waitForTimeout(1500);
    const d = await panel(page).evaluate((root) => {
      const lab = (el) => { if (el.id) { const l = root.querySelector(`label[for="${el.id}"]`); if (l) return l.innerText.trim(); } const l = el.closest('label'); if (l) return l.innerText.trim(); let c = el.parentElement; for (let k = 0; k < 3 && c; k++) { const t = c.querySelector('label, .label'); if (t) return t.innerText.trim(); c = c.parentElement; } return el.getAttribute('aria-label') || el.placeholder || ''; };
      const vis = (el) => el.getBoundingClientRect().width > 0;
      return [...root.querySelectorAll('input, select, textarea, [role=combobox], button')].filter(vis).map((el) => `${el.tagName.toLowerCase()}${el.type ? ':' + el.type : ''}${el.required ? '*' : ''} [${lab(el).replace(/\s+/g, ' ').slice(0, 50)}] ${el.tagName === 'BUTTON' ? '«' + el.innerText.trim().slice(0, 40) + '»' : ''}${el.tagName === 'SELECT' ? ' opts=' + [...el.options].map((o) => o.text.trim()).slice(0, 12).join('|') : ''} fcn=${el.getAttribute('formcontrolname') || ''}`);
    });
    console.log(`\n=== ${r}\n` + d.join('\n'));
  }
  await browser.close();
})();
