const { launch, instrument, uiLogin, snap, go, panel, panelText, netSince, api, toasts } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`);
const P = { TOR: '65ebed48-38e2-477f-8765-41f7d1ab879b', CAB: 'da888aaa-a524-409e-8977-ec9c97007e36', TORC: '19159a65-4f7d-4a96-869d-2b7f75bff748' };
const WN = '1688f859-df1f-4fdc-90c0-3a8feb63869d';
const draft = (page, lines, extra = {}) => api(page, 'POST', '/inventory/adjustments', { date: '2026-10-29', warehouseId: WN, reason: 'QA-7734 prueba', lines, ...extra });
(async () => {
  const { browser, context } = await launch();
  const A = await context.newPage();
  const log = instrument(A);
  await uiLogin(A);
  await go(A, 'inventory/adjustments');
  // 1) Valor obsoleto: A ve existencia 95 y cuenta 95-? ; B mueve antes de que A contabilice
  const d1 = await draft(A, [{ productId: P.TOR, countedQuantity: 90 }]);
  out('d1', [d1.status, d1.body.number]);
  await go(A, `inventory/adjustments/${d1.body.id}`); await A.waitForTimeout(2500);
  out('A ve antes', await panel(A).locator('tbody tr td:nth-child(2)').allInnerTexts());
  out('A placeholder cambio', await panel(A).locator('input[formcontrolname=quantityChange]').evaluateAll((e) => e.map((x) => x.placeholder)));
  await snap(A, '21-inv-obsoleto-antes');
  // Sesión B (otra pestaña/contexto) retira 10 del mismo producto
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
  await ctxB.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const B = await ctxB.newPage(); await uiLogin(B); await go(B, 'inventory/adjustments');
  const d2 = await draft(B, [{ productId: P.TOR, quantityChange: -10 }], { reason: 'QA-7734 sesión B merma' });
  const p2 = await api(B, 'POST', `/inventory/adjustments/${d2.body.id}/post`);
  out('B contabiliza', [p2.status, p2.body?.lines?.map((l) => [l.quantityBefore, l.quantityChange])]);
  // A contabiliza sin recargar
  await panel(A).getByRole('button', { name: 'Contabilizar' }).click(); await A.waitForTimeout(800);
  out('dialogo A', await A.locator('[role=dialog], [role=alertdialog]').last().innerText());
  let n = log.requests.length;
  // doble clic en confirmar
  await A.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: 'Contabilizar' }).last().dblclick();
  await A.waitForTimeout(3000);
  out('red doble clic contabilizar', netSince(log, n));
  await snap(A, '22-inv-obsoleto-despues');
  const r1 = await api(A, 'GET', `/inventory/adjustments/${d1.body.id}`);
  out('resultado A', r1.body.lines.map((l) => ({ antes: l.quantityBefore, contado: l.countedQuantity, cambio: l.quantityChange, valor: l.valueChange })));
  out('DOM tras contabilizar (sin recargar)', await panel(A).locator('tbody input').evaluateAll((els) => els.map((e) => ({ n: e.getAttribute('formcontrolname') || e.getAttribute('aria-label'), dis: e.disabled, v: e.value }))));
  out('texto A tras post', (await panelText(A)).slice(-500));
  // 2) Doble clic en Guardar al crear
  await go(A, 'inventory/adjustments/new'); await A.waitForTimeout(2000);
  await panel(A).locator('#adj-warehouse').selectOption({ label: 'QA-7734 Almacén Norte' });
  await panel(A).locator('#adj-reason').fill('QA-7734 doble clic');
  const box = panel(A).locator('tbody tr').nth(0).locator('[role=combobox]');
  await box.click(); await box.fill('QA-7734-CAB'); await A.waitForTimeout(1200); await A.locator('[role=option]').first().click(); await A.waitForTimeout(800);
  await panel(A).locator('input[formcontrolname=quantityChange]').fill('-1');
  n = log.requests.length;
  await panel(A).locator('button[type=submit]').dblclick(); await A.waitForTimeout(2500);
  out('red doble clic guardar', netSince(log, n).filter((x) => x.startsWith('POST')));
  // 3) Stock negativo: cambio -1000
  const d3 = await draft(A, [{ productId: P.CAB, quantityChange: -1000 }], { reason: 'QA-7734 negativo' });
  await go(A, `inventory/adjustments/${d3.body.id}`); await A.waitForTimeout(2000);
  await panel(A).getByRole('button', { name: 'Contabilizar' }).click(); await A.waitForTimeout(800);
  await A.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: 'Contabilizar' }).last().click(); await A.waitForTimeout(2500);
  await snap(A, '23-inv-negativo');
  out('toast negativo', await A.locator('[role=alert], [class*=toast]').allInnerTexts());
  // 4) Fecha fuera de período / futura
  const d4 = await draft(A, [{ productId: P.CAB, quantityChange: 1 }], { reason: 'QA-7734 fecha antigua', date: '2019-01-15' });
  out('crear fecha 2019', [d4.status, JSON.stringify(d4.body).slice(0, 300)]);
  if (d4.body?.id) { const p4 = await api(A, 'POST', `/inventory/adjustments/${d4.body.id}/post`); out('post fecha 2019', [p4.status, JSON.stringify(p4.body).slice(0, 400)]); }
  const d5 = await draft(A, [{ productId: P.CAB, quantityChange: 1 }], { reason: 'QA-7734 fecha futura', date: '2031-06-01' });
  out('crear fecha 2031', [d5.status, d5.body?.number]);
  if (d5.body?.id) { const p5 = await api(A, 'POST', `/inventory/adjustments/${d5.body.id}/post`); out('post fecha 2031', [p5.status, JSON.stringify(p5.body).slice(0, 400)]); }
  // 5) Contado + cambio a la vez, contado negativo (UI)
  await go(A, `inventory/adjustments/new`); await A.waitForTimeout(2000);
  const box2 = panel(A).locator('tbody tr').nth(0).locator('[role=combobox]');
  await box2.click(); await box2.fill('QA-7734-CAB'); await A.waitForTimeout(1200); await A.locator('[role=option]').first().click(); await A.waitForTimeout(800);
  await panel(A).locator('#adj-reason').fill('QA');
  await panel(A).locator('input[formcontrolname=countedQuantity]').fill('-3');
  await panel(A).locator('input[formcontrolname=quantityChange]').fill('2');
  await panel(A).locator('input[formcontrolname=unitCost]').fill('-1');
  n = log.requests.length;
  await panel(A).locator('button[type=submit]').click(); await A.waitForTimeout(1500);
  await snap(A, '24-inv-validaciones-linea');
  out('banner', await panel(A).locator('.dr__banner').innerText().catch(() => '-'));
  out('aria-invalid', await panel(A).locator('tbody input').evaluateAll((els) => els.map((e) => [e.getAttribute('formcontrolname'), e.getAttribute('aria-invalid'), e.className])));
  out('red', netSince(log, n));
  // 6) Cerrar la pestaña con cambios sin guardar
  await A.keyboard.press('Escape'); await A.waitForTimeout(500);
  out('tras Escape url', A.url());
  const closeBtn = A.locator('.dv-tab.dv-active-tab .dv-default-tab-action, .dv-active-tab [aria-label*=errar]').first();
  out('close btn', await closeBtn.count());
  if (await closeBtn.count()) { await closeBtn.click(); await A.waitForTimeout(1000); await snap(A, '25-inv-cerrar-sucio'); out('dialogo cerrar', await A.locator('[role=dialog], [role=alertdialog]').allInnerTexts()); }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
