// Detalle de factura: toolbar (imprimir, correo, búsqueda, PDF, copiar de/a), pestañas, anular FAC-00000002 (QA);
// edición de cliente QA; XSS almacenado en nombre de producto/cliente.
const fs = require('fs');
const path = require('path');
const { launch, instrument, uiLogin, shot, go, fill, click, panel, panelText, netSince, errorsShown, stepUpAll, toasts } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); console.log('DIALOG-NATIVO', d.message()); d.accept(); });
  page.on('popup', (pp) => console.log('POPUP', pp.url()));
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); const su = await stepUpAll(page); if (su) await page.waitForTimeout(1500); console.log(`[${name}] stepups=${su} err=${JSON.stringify(await errorsShown(page)).slice(0, 200)}\n   red=${netSince(log, n).map((x) => x.slice(0, 150)).join(' ; ').slice(0, 700)}\n   texto=${(await panelText(page)).replace(/\n+/g, ' | ').slice(0, 300)}`); await shot(page, `f-fa-${name}`); };
  await go(page, 'invoices');
  await step('abrir-fac2', async () => { await p.getByText('FAC-00000002').first().click(); await page.waitForTimeout(2500); });
  const tb = await p.locator('button').evaluateAll((bs) => bs.map((b) => (b.getAttribute('aria-label') || b.title || b.innerText || '').trim()));
  console.log('TOOLBAR', JSON.stringify(tb));
  for (const t of ['Logística', 'Finanzas', 'Contenido']) await step(`tab-${t}`, async () => { await p.getByRole('tab', { name: t }).or(p.getByText(t, { exact: true })).first().click(); });
  const names = ['Primero','Anterior','Siguiente','Último','Volver','Avanzar','Imprimir','Enviar por correo','Búsqueda sobre documento','Exportar a PDF','Exportar a Excel','Exportar a Word','Copiar de...','Copiar a...','Parametrizaciones de formulario','Ayuda'];
  for (const nm of names) {
    await go(page, 'invoices'); await p.getByText('FAC-00000001').first().click(); await page.waitForTimeout(2000);
    const before = (await p.locator('h1, h2').first().innerText().catch(() => '')) + ' ' + page.url().split('/e/')[1];
    const dl = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
    await step(`icono-${nm.replace(/[^a-zA-Z]/g, '')}`, async () => { await p.getByRole('button', { name: nm, exact: true }).first().click(); await page.waitForTimeout(1200); const after = (await p.locator('h1, h2').first().innerText().catch(() => '')) + ' ' + page.url().split('/e/')[1]; console.log(`   ANTES=${before} DESPUES=${after} DIALOGO=${(await page.locator('[role=dialog]').allInnerTexts()).join(' / ').replace(/\n+/g, ' ').slice(0, 200)}`); });
    const d = await dl; if (d) console.log('   DESCARGA', d.suggestedFilename());
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  }
  await go(page, 'invoices'); await p.getByText('FAC-00000002').first().click(); await page.waitForTimeout(2000);
  console.log('BOTONES-DETALLE', JSON.stringify((await p.getByRole('button').allInnerTexts()).map((x) => x.trim()).filter(Boolean)));
  await step('anular-fac2', async () => { await p.getByRole('button', { name: /Anular/ }).first().click(); await page.waitForTimeout(1000); await shot(page, 'f-fa-anular-dialogo'); const r = page.locator('[role=dialog] textarea, [role=dialog] input').last(); if (await r.count()) await r.fill('QA - anulación de prueba'); await page.getByRole('button', { name: /^(Anular|Aceptar|Confirmar)/ }).last().click({ timeout: 3000 }).catch(() => {}); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
