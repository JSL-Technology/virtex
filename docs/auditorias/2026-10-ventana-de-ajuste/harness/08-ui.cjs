const fs = require('fs');
const { launch, instrument, uiLogin, snap, go, panel, panelText, netSince, api } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v)}`);
const AXE = '/tmp/claude-0/-home-user-virtex/16a56624-fcd2-58a5-a86d-b5fc046524c4/scratchpad/axe/node_modules/axe-core/axe.min.js';
const P = { TOR: '65ebed48-38e2-477f-8765-41f7d1ab879b' };
const measure = (page, sel) => panel(page).evaluate((root, sel) => {
  const pick = (q) => { const e = root.querySelector(q); if (!e) return null; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return { q, font: `${s.fontFamily.split(',')[0]} ${s.fontSize}/${s.fontWeight}`, color: s.color, bg: s.backgroundColor, border: s.borderTopColor + ' ' + s.borderTopWidth, radius: s.borderTopLeftRadius, h: Math.round(r.height), w: Math.round(r.width), pad: s.padding }; };
  return sel.map(pick);
}, sel);
const SEL = ['h1', 'label span, label, .form-group label', 'input[type=text], input:not([type])', 'select', 'button[type=submit]', '.dr__cancel, button.secondary-button', 'th', 'td', '.form-section-title, h2', 'input[type=number]', '.form-hint, small.hint'];
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page);
  // Entrada desde el producto
  await go(page, `inventory/products/${P.TOR}/edit`); await page.waitForTimeout(3000);
  await snap(page, '32-producto-ficha');
  const link = panel(page).getByText('Ajustar existencias');
  out('enlace ajustar', await link.count());
  if (await link.count()) { await link.first().click(); await page.waitForTimeout(3000); out('url desde producto', page.url()); await snap(page, '33-inv-desde-producto'); out('linea precargada', await panel(page).locator('tbody [role=combobox]').evaluateAll((e) => e.map((x) => x.value))); out('almacen', await panel(page).locator('#adj-warehouse').evaluate((e) => e.selectedOptions[0]?.text)); out('existencia', await panel(page).locator('tbody tr td:nth-child(2)').allInnerTexts()); }
  // Kardex: ¿la referencia enlaza al ajuste?
  await go(page, 'inventory/kardex'); await page.waitForTimeout(2500);
  out('kardex enlaces', await panel(page).locator('tbody a').evaluateAll((a) => a.map((x) => x.innerText + ' -> ' + x.getAttribute('href')).slice(0, 8)));
  // Mediciones: ajuste nuevo, transferencia nueva, ajuste de auditoría nuevo, asiento nuevo, factura nueva
  const screens = { ajuste_inventario: 'inventory/adjustments/new', transferencia: 'inventory/transfers/new', ajuste_auditoria: 'accounting/audit-adjustments/new', asiento: 'accounting/journal-entries/new', producto: 'inventory/products/new' };
  const M = {};
  for (const [k, p] of Object.entries(screens)) { await go(page, p); await page.waitForTimeout(2500); M[k] = await measure(page, SEL); await snap(page, `40-equiv-${k}`); }
  fs.writeFileSync(__dirname + '/../mediciones.json', JSON.stringify(M, null, 1));
  out('mediciones', 'guardadas');
  // Teclado en ajuste nuevo
  await go(page, 'inventory/adjustments/new'); await page.waitForTimeout(2500);
  await panel(page).locator('#adj-date').focus().catch(() => {});
  await page.locator('body').click({ position: { x: 700, y: 140 } });
  const seq = [];
  for (let i = 0; i < 22; i++) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}[${e.getAttribute('aria-label') || e.getAttribute('formcontrolname') || (e.innerText || '').trim().slice(0, 20)}] outline=${s.outlineStyle}/${s.outlineWidth} shadow=${s.boxShadow !== 'none' ? 'si' : 'no'}`; })); }
  out('orden tab', seq);
  // axe
  await page.addScriptTag({ path: AXE });
  const ax = await page.evaluate(async () => { const root = document.querySelector('.dv-groupview.dv-active-group .dv-content-container'); const r = await axe.run(root, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, ej: v.nodes.slice(0, 3).map((x) => x.target.join(' ') + ' :: ' + (x.failureSummary || '').split('\n')[1]) })); });
  out('axe ajuste nuevo', ax);
  // Tamaños
  for (const [w, h, name] of [[1920, 1080, '1920'], [1366, 768, '1366'], [768, 1024, 'tableta'], [375, 812, 'movil'], [720, 450, 'zoom200']]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(1500);
    await snap(page, `50-inv-${name}`);
    const info = await page.evaluate(() => { const sv = document.querySelector('button[type=submit]'); const r = sv?.getBoundingClientRect(); return { scrollW: document.documentElement.scrollWidth, vw: innerWidth, saveVisible: r ? (r.right <= innerWidth && r.bottom <= innerHeight && r.width > 0) : false, save: r && [Math.round(r.x), Math.round(r.y), Math.round(r.width)] }; });
    const tbl = await panel(page).locator('.table-wrapper').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth })).catch(() => null);
    out(`viewport ${name}`, { ...info, tabla: tbl });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // Tema oscuro
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.locator('header button[aria-label*="tema" i], app-theme-toggle button').first().click().catch(() => {});
  await page.waitForTimeout(1000);
  await snap(page, '55-inv-oscuro');
  out('theme attr', await page.evaluate(() => [document.documentElement.getAttribute('data-theme'), document.documentElement.className, getComputedStyle(document.body).backgroundColor]));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
