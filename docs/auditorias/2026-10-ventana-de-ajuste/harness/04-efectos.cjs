const { launch, instrument, uiLogin, snap, go, panel, panelText, netSince, api } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`);
const ID = process.argv[2];
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  await go(page, `inventory/adjustments/${ID}`); await page.waitForTimeout(2500);
  const doc = await api(page, 'GET', `/inventory/adjustments/${ID}`);
  out('api doc', doc.body);
  out('controles linea', await panel(page).locator('tbody input, tbody [role=combobox], tbody button').evaluateAll((els) => els.map((e) => ({ tag: e.tagName, name: e.getAttribute('formcontrolname') || e.getAttribute('aria-label'), disabled: e.disabled, readonly: e.readOnly, ph: e.placeholder, v: e.value }))));
  // ¿se puede escribir en el producto de una línea contabilizada?
  const cb = panel(page).locator('tbody [role=combobox]').first();
  await cb.click({ timeout: 3000 }).catch((e) => out('click combobox', e.message.split('\n')[0]));
  await page.waitForTimeout(500);
  out('panel opciones abierto', await page.locator('[role=listbox]').count());
  await snap(page, '17-inv-contabilizado-combobox');
  // Asiento
  const n = log.requests.length;
  await panel(page).getByText('Ver asiento').click(); await page.waitForTimeout(3000);
  out('url asiento', page.url());
  await snap(page, '18-inv-asiento');
  out('asiento texto', (await panelText(page)).slice(0, 2500));
  out('red asiento', netSince(log, n));
  // Kardex
  await go(page, 'inventory/kardex'); await page.waitForTimeout(2500);
  await snap(page, '19-kardex');
  out('kardex', (await panelText(page)).slice(0, 2500));
  // Existencias
  await go(page, 'inventory/stock'); await page.waitForTimeout(2500);
  await snap(page, '20-existencias');
  out('stock', (await panelText(page)).slice(0, 1800));
  const st = await api(page, 'GET', '/inventory/stock?limit=50');
  out('stock api', st.body.items.map((i) => [i.sku, i.warehouseName, i.quantityOnHand, i.unitCost, i.value]));
  const mv = await api(page, 'GET', '/inventory/movements?limit=20');
  out('mov api', JSON.stringify(mv.body).slice(0, 2500));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
