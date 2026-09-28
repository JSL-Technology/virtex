// Workspace, Análisis y Datos: búsqueda global, notificaciones, accesos rápidos, exportación (descarga),
// importación CSV, repositorio/plantillas (subida), DataSheets, extensiones (sandbox), POS, conciliación, requisición→aprobaciones.
const fs = require('fs');
const path = require('path');
const { launch, instrument, uiLogin, shot, go, click, panel, panelText, netSince, errorsShown, stepUpAll, toasts } = require('./lib.cjs');
const TMP = path.join(__dirname, '..', 'evidence', 'tmp'); fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'qa-clientes.csv'), 'companyName,email,country\nQA-Import Cliente A,qa-imp-a@example.com,DO\nQA-Import Cliente B,correo-malo,DO\n');
fs.writeFileSync(path.join(TMP, 'qa-documento.txt'), 'Documento de prueba QA');
fs.writeFileSync(path.join(TMP, 'qa-estado-cuenta.csv'), 'fecha,descripcion,monto\n2026-09-28,Deposito QA,1000.00\n2026-09-28,Pago proveedor QA,-5000.00\n');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); const su = await stepUpAll(page); if (su) await page.waitForTimeout(1500); console.log(`[${name}] stepups=${su} err=${JSON.stringify(await errorsShown(page)).slice(0, 200)}\n   red=${netSince(log, n).map((x) => x.slice(0, 150)).join(' ; ').slice(0, 900)}\n   texto=${(await panelText(page)).replace(/\n+/g, ' | ').slice(0, 350)}`); await shot(page, `f-ws-${name}`); };
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  const S = async (name, fn) => { if (!only || only.test(name)) await step(name, fn); };
  // Búsqueda global (barra superior)
  await S('busqueda-top', async () => { const s = page.getByPlaceholder(/Buscar facturas, clientes/); await s.click(); await s.fill('QA'); await page.waitForTimeout(1500); console.log('RESULTADOS', (await page.locator('[role=listbox], [role=option], .cdk-overlay-pane').allInnerTexts()).join(' | ').replace(/\n+/g, ' ').slice(0, 400)); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); });
  await go(page, 'global-search');
  await S('busqueda-pagina', async () => { const s = p.getByPlaceholder(/Buscar en todo el sistema/); await s.fill('FAC-00000001'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); });
  await S('busqueda-especiales', async () => { const s = p.getByPlaceholder(/Buscar en todo el sistema/); await s.fill(`' OR 1=1 -- <script>`); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); });
  // Notificaciones
  await go(page, 'notifications');
  await S('notif-marcar', async () => { await click(page, 'Marcar todas como leídas'); });
  await S('campana', async () => { await page.locator('header button').filter({ has: page.locator('svg') }).nth(1).click(); await page.waitForTimeout(1000); console.log('CAMPANA', (await page.locator('.cdk-overlay-pane, [role=menu], [role=dialog]').allInnerTexts()).join(' | ').slice(0, 300)); await page.keyboard.press('Escape'); });
  // Accesos rápidos de Inicio
  for (const q of ['Nueva cotización', 'Ver dashboard financiero', 'Reportes']) { await go(page, 'overview'); await S(`inicio-${q}`, async () => { await p.getByText(q, { exact: true }).first().click(); await page.waitForTimeout(1500); console.log('URL', page.url()); }); }
  // Exportación con descarga
  await go(page, 'data-exports');
  await S('export-csv', async () => {
    const sel = p.locator('select').first(); console.log('TIPOS', JSON.stringify(await sel.evaluate((s) => [...s.options].map((o) => o.text))));
    await sel.selectOption({ label: 'Customers' }).catch(() => sel.selectOption({ index: 1 }));
    await click(page, 'Generar archivo'); await page.waitForTimeout(3000);
    const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await p.getByRole('button', { name: 'Descargar' }).first().click().catch((e) => console.log('nodescarga', e.message.split('\n')[0]));
    const d = await dl; if (d) { const f = path.join(TMP, d.suggestedFilename()); await d.saveAs(f); console.log('DESCARGADO', d.suggestedFilename(), fs.readFileSync(f, 'utf8').slice(0, 300).replace(/\n/g, ' ⏎ ')); } else console.log('SIN-DESCARGA');
  });
  // Importación CSV
  await go(page, 'data-imports');
  await S('import-csv', async () => {
    await p.locator('select').first().selectOption({ label: 'Customers' }).catch(() => {});
    await page.waitForTimeout(800);
    const file = p.locator('input[type=file]'); console.log('FILE-INPUTS', await file.count());
    if (await file.count()) await file.first().setInputFiles(path.join(TMP, 'qa-clientes.csv'));
    await page.waitForTimeout(1500); console.log('PASO', (await panelText(page)).replace(/\n+/g, ' | ').slice(0, 600));
    for (const b of ['Siguiente', 'Continuar', 'Validar', 'Importar datos', 'Importar']) { const x = p.getByRole('button', { name: b }); if ((await x.count()) && !(await x.first().isDisabled())) { await x.first().click(); await page.waitForTimeout(2500); console.log('CLIC', b); } }
  });
  // Documentos
  await go(page, 'documents/repository');
  await S('doc-carpeta', async () => { await click(page, 'Nueva carpeta'); const i = page.locator('[role=dialog] input, .cdk-overlay-pane input').last(); if (await i.count()) { await i.fill('QA-Carpeta'); await page.keyboard.press('Enter'); } });
  await S('doc-subir', async () => { await p.locator('input[type=file]').first().setInputFiles(path.join(TMP, 'qa-documento.txt')); await page.waitForTimeout(2500); });
  await go(page, 'documents/templates');
  await S('plantilla-subir', async () => { await p.locator('input[type=file]').first().setInputFiles(path.join(TMP, 'qa-documento.txt')); await page.waitForTimeout(2500); });
  // DataSheets
  await go(page, 'datasheets');
  await S('ds-abrir-demo', async () => { await p.getByText('Estado de Resultados Q1').click(); await page.waitForTimeout(2500); });
  await go(page, 'datasheets');
  await S('ds-nuevo', async () => { await click(page, 'Nuevo Libro'); await page.waitForTimeout(2000); });
  // POS
  await go(page, 'sales/pos');
  await S('pos-venta', async () => { const s = p.getByPlaceholder(/Buscar productos/); await s.fill('QA-Producto'); await page.waitForTimeout(1500); await p.getByText('QA-Producto-01').first().click().catch((e) => console.log('noprod', e.message.split('\n')[0])); await page.waitForTimeout(800); console.log('ORDEN', (await panelText(page)).replace(/\n+/g, ' | ').slice(0, 400)); await click(page, 'Cobrar'); await page.waitForTimeout(1500); console.log('COBRO', (await page.locator('[role=dialog]').last().innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 400)); });
  // Conciliación
  await go(page, 'accounting/reconciliation/import');
  await S('conc-import', async () => { console.log('FORM', (await panelText(page)).replace(/\n+/g, ' | ').slice(0, 500)); const f = p.locator('input[type=file]'); if (await f.count()) await f.first().setInputFiles(path.join(TMP, 'qa-estado-cuenta.csv')); await page.waitForTimeout(1500); await p.getByRole('button', { name: 'Importar estado de cuenta' }).last().click().catch(() => {}); });
  // Requisición → aprobación → bandeja
  await go(page, 'purchasing/requisitions');
  await S('req-enviar', async () => { await p.getByText('REQ-2026-000001').first().click(); await page.waitForTimeout(2000); await click(page, 'Enviar a aprobación'); await page.getByRole('button', { name: /^(Aceptar|Confirmar|Enviar)$/ }).last().click({ timeout: 2500 }).catch(() => {}); });
  await go(page, 'approvals');
  await S('aprobaciones', async () => {});
  await go(page, 'my-work');
  await S('mi-trabajo', async () => {});
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
