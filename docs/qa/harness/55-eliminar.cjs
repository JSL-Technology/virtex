// Eliminaciones SOLO sobre datos creados en esta sesión (prefijo QA-/qa-): con dependencias (debe rechazar)
// y sin dependencias (debe permitir). También: clic en filas de actividad / vencimientos de Inicio.
const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, stepUpAll, toasts } = require('./lib.cjs');
const CASES = [
  ['contacts/customers', 'QA-Cliente-01', 'con facturas: debe rechazar'],
  ['contacts/suppliers', 'QA-Proveedor-01', 'con factura de proveedor: debe rechazar'],
  ['inventory/products', 'QA-XSS', 'sin movimientos: debe permitir'],
  ['inventory/products', 'QA-Producto-01', 'con facturas/OC: debe rechazar'],
  ['inventory/categories', 'QA-Categoría', 'sin productos: debe permitir'],
  ['hcm/departments', 'QA-Departamento', 'con empleado: debe rechazar'],
  ['payroll/concepts', 'QA-BONO', 'sin uso: debe permitir'],
  ['masters/price-lists', 'QA-Lista', 'sin uso: debe permitir'],
  ['documents/repository', 'qa-documento.txt', 'sin uso: debe permitir'],
  ['accounting/chart-of-accounts', '5910', 'sin movimientos: debe permitir'],
];
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('   DIALOG-NATIVO', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  for (const [route, key, expect] of CASES) {
    await go(page, route); await page.waitForTimeout(1500);
    if (route === 'accounting/chart-of-accounts') { await p.locator('select').nth(1).selectOption({ label: 'Gasto' }).catch(() => {}); await page.waitForTimeout(800); }
    const row = p.locator('tr').filter({ hasText: key }).first();
    if (!(await row.count())) { console.log(`[${route} ${key}] fila no encontrada`); continue; }
    const n = log.requests.length;
    const del = row.getByRole('button', { name: /Eliminar|Retirar|Borrar/ }).or(row.getByRole('link', { name: /Eliminar|Retirar/ }));
    if (!(await del.count())) { console.log(`[${route} ${key}] sin acción de eliminar en la fila; botones=${JSON.stringify(await row.getByRole('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') || b.innerText)))}`); continue; }
    const lbl = await del.first().evaluate((b) => b.getAttribute('aria-label') || b.innerText);
    await del.first().click(); await page.waitForTimeout(900);
    const confirmTxt = (await page.getByText(/¿Seguro|No se puede deshacer|Retirar/).allInnerTexts().catch(() => [])).join(' / ').replace(/\n+/g, ' ').slice(0, 200);
    const btns = page.getByRole('button', { name: new RegExp(`^\\s*${lbl.trim()}\\s*$`) });
    const nb = await btns.count();
    if (nb > await p.getByRole('button', { name: new RegExp(`^\\s*${lbl.trim()}\\s*$`) }).count()) await btns.last().click({ timeout: 2500 }).catch((e) => console.log('   noconfirm', e.message.split('\n')[0]));
    else { const alt = page.getByRole('button', { name: /^(Aceptar|Confirmar)$/ }); if (await alt.count()) await alt.last().click().catch(() => {}); }
    await page.waitForTimeout(1500); const su = await stepUpAll(page); await page.waitForTimeout(1200);
    if (await page.getByRole('button', { name: 'Cancelar' }).count()) { await page.getByRole('button', { name: 'Cancelar' }).last().click().catch(() => {}); }
    const still = await p.locator('tr').filter({ hasText: key }).count();
    const t = (await toasts(page)).split('|').map((x) => x.trim()).filter((x) => x && !/Virtex Dev|Periodo|Conectado/.test(x)).slice(-2).join(' / ');
    console.log(`[${route} ${key}] (${expect}) boton="${lbl}" confirmacion="${confirmTxt}" stepups=${su} red=${netSince(log, n).map((x) => x.slice(0, 160)).join(' ; ')} sigue-en-lista=${still > 0} toast="${t.slice(0, 160)}"`);
    await shot(page, `f-del-${route.replace(/\//g, '_')}-${key.replace(/[^a-zA-Z0-9]/g, '')}`);
  }
  // Inicio: filas de actividad y vencimientos
  for (const txt of ['Asiento VENTAS-2026-000001 contabilizado', 'Vence la factura FAC-00000002', 'Cierre del período «agosto de 2026»']) {
    await go(page, 'overview'); await page.waitForTimeout(1500);
    const u = page.url(); const n = log.requests.length;
    await p.getByText(txt).first().click().catch((e) => console.log('noclick', e.message.split('\n')[0]));
    await page.waitForTimeout(1500);
    console.log(`[inicio] "${txt}" -> url=${page.url() !== u ? page.url().split('/e/')[1] : '='} red=${netSince(log, n).length} texto=${(await panelText(page)).slice(0, 80).replace(/\n+/g, ' ')}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
