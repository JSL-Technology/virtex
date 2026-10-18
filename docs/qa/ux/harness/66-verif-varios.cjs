// Verifica A-19 (búsqueda de factura por NCF), A-20/A-14 (menú «Crear nuevo» y atajos) y M-18 (unidades).
const { launch, login } = require('./lib.cjs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'evidence', 'fix');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await login(page);
  const base = page.url().split('/').slice(0, 5).join('/');
  // A-19: buscar por NCF en la barra superior.
  const search = page.locator('.global-search input').first();
  await search.click(); await search.fill('B02'); await page.waitForTimeout(2500);
  const results = await page.locator('.result-group').first().innerText().catch(() => '');
  console.log('A-19 resultados:', results.replace(/\s+/g, ' ').slice(0, 300));
  await page.screenshot({ path: path.join(OUT, 'A19-busqueda-ncf.png') });
  await page.keyboard.press('Escape');
  // A-20/A-14: menú «Crear nuevo».
  await page.locator('.quick-create-menu button, .quick-create-menu').first().click(); await page.waitForTimeout(800);
  const menu = page.locator('.quick-create-dropdown');
  const rows = await menu.locator('.quick-action-item').evaluateAll((items) => items.map((i) => {
    const label = i.querySelector('.quick-action-label').getBoundingClientRect();
    const chip = i.querySelector('.quick-action-shortcut').getBoundingClientRect();
    return `${i.innerText.replace(/\s+/g, ' ').trim()} | solapa=${label.right > chip.left + 1}`;
  }));
  console.log('A-20 menú:', rows.join(' || '));
  await page.screenshot({ path: path.join(OUT, 'A20-menu-crear-nuevo.png') });
  await page.keyboard.press('Escape');
  // A-14: Alt+Shift+Q abre una cotización nueva; dentro de un campo no hace nada.
  await page.keyboard.press('Alt+Shift+KeyQ'); await page.waitForTimeout(2500);
  console.log('A-14 Alt+Shift+Q →', page.url().replace(/^.*\/e\/[^/]+/, ''));
  // M-18: unidades de medida.
  await page.goto(`${base}/masters/units-of-measure`); await page.waitForTimeout(3500);
  const panel = page.locator('.dv-groupview.dv-active-group .dv-content-container').first();
  await panel.getByRole('button', { name: /Nueva unidad/ }).click(); await page.waitForTimeout(500);
  const sym = 'SC' + String(Date.now()).slice(-4);
  await panel.locator('#uom-name').fill('Saco de 50 kg');
  await panel.locator('#uom-symbol').fill(sym);
  await panel.locator('#uom-category').selectOption('Weight');
  await panel.getByRole('button', { name: /Guardar/ }).click(); await page.waitForTimeout(2500);
  const firstRows = await panel.locator('tbody tr').evaluateAll((r) => r.slice(0, 6).map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  console.log('M-18 filas:', firstRows.join(' | '));
  console.log('M-18 propia creada:', await panel.locator(`tbody tr:has-text("${sym}")`).count());
  await page.screenshot({ path: path.join(OUT, 'M18-unidades.png') });
  await browser.close();
})();
