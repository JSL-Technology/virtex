const { launch, instrument, uiLogin, snap, go, panel, panelText, netSince, api } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`);
const P = { TOR: '65ebed48-38e2-477f-8765-41f7d1ab879b', CAB: 'da888aaa-a524-409e-8977-ec9c97007e36' };
const WN = '1688f859-df1f-4fdc-90c0-3a8feb63869d';
const draft = (page, lines, extra = {}) => api(page, 'POST', '/inventory/adjustments', { date: '2026-10-29', warehouseId: WN, reason: 'QA-7734 prueba', lines, ...extra });
(async () => {
  const { browser, context } = await launch();
  const A = await context.newPage(); const log = instrument(A);
  await uiLogin(A); await go(A, 'inventory/adjustments');
  const d = await draft(A, [{ productId: P.CAB, quantityChange: 1 }], { reason: 'QA-7734 período cerrado', date: '2031-08-10' });
  out('crear en período cerrado', [d.status, d.body.number]);
  await go(A, `inventory/adjustments/${d.body.id}`); await A.waitForTimeout(2000);
  await panel(A).getByRole('button', { name: 'Contabilizar' }).click(); await A.waitForTimeout(700);
  await A.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: 'Contabilizar' }).last().click(); await A.waitForTimeout(2500);
  await snap(A, '27-inv-periodo-cerrado');
  out('toast periodo cerrado', [...new Set(await A.locator('[role=alert]').allInnerTexts())]);
  out('red', netSince(log).slice(-3));
  // Anular borrador
  const dd = await draft(A, [{ productId: P.CAB, quantityChange: 1 }], { reason: 'QA-7734 para anular' });
  await go(A, `inventory/adjustments/${dd.body.id}`); await A.waitForTimeout(2000);
  await panel(A).getByRole('button', { name: 'Anular' }).click(); await A.waitForTimeout(700);
  await snap(A, '28-inv-anular-dialogo');
  out('dialogo anular', await A.locator('[role=dialog], [role=alertdialog]').last().innerText());
  await A.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: 'Anular' }).last().click(); await A.waitForTimeout(2500);
  await snap(A, '29-inv-anulado');
  out('toast anulado', [...new Set(await A.locator('[role=alert], [role=status]').allInnerTexts())]);
  out('texto anulado', (await panelText(A)).slice(0, 400));
  out('botones', await panel(A).locator('button:visible').allInnerTexts());
  // ¿Se puede revertir un contabilizado? Abrir AJ-2026-000001
  const list = await api(A, 'GET', '/inventory/adjustments');
  const first = (list.body.items || list.body).find((x) => x.number === 'AJ-2026-000001');
  await go(A, `inventory/adjustments/${first.id}`); await A.waitForTimeout(2500);
  out('acciones en contabilizado', await panel(A).locator('button:visible, a:visible').allInnerTexts());
  // Mapa de relaciones
  await panel(A).getByText('Mapa de relaciones').click(); await A.waitForTimeout(2500);
  await snap(A, '30-inv-mapa-relaciones');
  out('mapa', (await A.locator('[role=dialog]').last().innerText().catch(() => panelText(A))).slice(0, 800));
  // Lista con datos
  await A.keyboard.press('Escape');
  await go(A, 'inventory/adjustments'); await A.waitForTimeout(2500);
  await snap(A, '31-inv-lista-con-datos');
  out('lista', (await panelText(A)).slice(0, 2500));
  // Ficha de producto: enlace «Ajustar existencia»
  await go(A, `inventory/products/${P.TOR}`); await A.waitForTimeout(2500);
  out('url producto', A.url());
  const link = panel(A).getByText('Ajustar existencia');
  out('enlace ajustar', await link.count());
  await snap(A, '32-producto-ficha');
  if (await link.count()) { await link.first().click(); await A.waitForTimeout(2500); out('url desde producto', A.url()); await snap(A, '33-inv-desde-producto'); out('linea precargada', await panel(A).locator('tbody [role=combobox]').evaluateAll((e) => e.map((x) => x.value))); out('existencia', await panel(A).locator('tbody tr td:nth-child(2)').allInnerTexts()); }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
