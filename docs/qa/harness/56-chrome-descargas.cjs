// Controles globales de la cabecera/riel/pestañas + descargas SUIR (nómina) y 606/607 (Ajustes → Facturación electrónica).
const fs = require('fs');
const path = require('path');
const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('popup', (pp) => console.log('   POPUP', pp.url()));
  await uiLogin(page);
  const p = panel(page);
  const probe = async (tag, fn) => { const n = log.requests.length; const u = page.url(); const tabs = await page.locator('.dv-tab').count(); const th = await page.evaluate(() => document.documentElement.className + '|' + (document.documentElement.getAttribute('data-theme') || '')); try { await fn(); } catch (e) { console.log(`[${tag}] EXC ${e.message.split('\n')[0]}`); return; } await page.waitForTimeout(1200); const ov = (await page.locator('.cdk-overlay-pane, [role=menu], [role=dialog], [role=listbox]').allInnerTexts()).join(' / ').replace(/\n+/g, ' ').slice(0, 220); const th2 = await page.evaluate(() => document.documentElement.className + '|' + (document.documentElement.getAttribute('data-theme') || '')); console.log(`[${tag}] url=${page.url() !== u ? page.url().split('/e/')[1] : '='} pestañas=${tabs}->${await page.locator('.dv-tab').count()} tema=${th !== th2 ? th + ' -> ' + th2 : '='} overlay="${ov}" red=${netSince(log, n).map((x) => x.slice(0, 80)).join(' ; ').slice(0, 250)}`); await shot(page, `f-chrome-${tag}`); await page.keyboard.press('Escape'); await page.waitForTimeout(300); };
  const hdr = page.locator('header');
  const hb = await hdr.locator('button').evaluateAll((bs) => bs.map((b) => (b.getAttribute('aria-label') || b.title || b.innerText || '').trim()));
  console.log('HEADER-BOTONES', JSON.stringify(hb));
  await go(page, 'invoices'); await go(page, 'contacts/customers');
  await probe('atras', () => hdr.locator('button').nth(0).click());
  await probe('adelante', () => hdr.locator('button').nth(1).click());
  for (let i = 2; i < hb.length; i++) await probe(`hdr-${i}-${(hb[i] || 'sin-etiqueta').replace(/[^a-zA-Z]/g, '').slice(0, 15)}`, () => hdr.locator('button').nth(i).click());
  await probe('selector-empresa', () => page.getByText('EMPRESA ACTUAL').click());
  await probe('rail-Compras', () => page.getByText('Compras', { exact: true }).first().click());
  await probe('popout-pestaña', () => page.locator('[class*=popout], button[title*=ventana], [aria-label*=ventana]').first().click());
  const ov = page.locator('.dv-tabs-overflow-handle, [class*=overflow]').first(); if (await ov.count()) await probe('desbordamiento-pestañas', () => ov.click());
  await probe('atajo-ctrl-k', () => page.keyboard.press('Control+k'));
  // Descargas
  const dlProbe = async (tag, fn) => { const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null); const n = log.requests.length; await fn().catch((e) => console.log(`[${tag}] EXC ${e.message.split('\n')[0]}`)); await stepUpAll(page); const d = await dl; console.log(`[${tag}] descarga=${d ? d.suggestedFilename() : '-'} red=${netSince(log, n).map((x) => x.slice(0, 120)).join(' ; ').slice(0, 300)}`); if (d) { const f = path.join(__dirname, '..', 'evidence', 'tmp', d.suggestedFilename()); await d.saveAs(f).catch(() => {}); if (fs.existsSync(f)) console.log('   contenido:', fs.readFileSync(f).slice(0, 200).toString().replace(/\n/g, ' ⏎ ')); } };
  await go(page, 'payroll/runs'); await p.getByRole('link', { name: '2026-09' }).click(); await page.waitForTimeout(2000); await stepUpAll(page); await page.waitForTimeout(1500);
  await dlProbe('suir', () => p.getByRole('button', { name: 'Descargar SUIR' }).click());
  await page.evaluate(() => { location.hash = 'settings/fiscal'; }); await page.waitForTimeout(2000);
  const d = page.locator('[role=dialog]').first();
  const repSel = d.locator('select').last();
  for (const lbl of ['607 · Ventas', '606 · Compras']) {
    await repSel.selectOption({ label: lbl }).catch(() => {});
    await d.locator('input[formcontrolname=year], input[name=year]').fill('2026').catch(() => {});
    await d.locator('input[formcontrolname=month], input[name=month]').fill('9').catch(() => {});
    await dlProbe(`dgii-${lbl.slice(0, 3)}`, () => d.getByRole('button', { name: 'Descargar' }).click());
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
