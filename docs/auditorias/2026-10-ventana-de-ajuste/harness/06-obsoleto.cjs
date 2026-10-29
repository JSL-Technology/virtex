const { launch, instrument, uiLogin, snap, go, panel, panelText, netSince, api } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`);
const P = { TOR: '65ebed48-38e2-477f-8765-41f7d1ab879b', CAB: 'da888aaa-a524-409e-8977-ec9c97007e36' };
const WN = '1688f859-df1f-4fdc-90c0-3a8feb63869d';
const draft = (page, lines, extra = {}) => api(page, 'POST', '/inventory/adjustments', { date: '2026-10-29', warehouseId: WN, reason: 'QA-7734 prueba', lines, ...extra });
(async () => {
  const { browser, context } = await launch();
  const A = await context.newPage(); const log = instrument(A);
  await uiLogin(A); await go(A, 'inventory/adjustments');
  const d1 = await draft(A, [{ productId: P.TOR, countedQuantity: 88 }], { reason: 'QA-7734 conteo sesión A' });
  await go(A, `inventory/adjustments/${d1.body.id}`); await A.waitForTimeout(2500);
  out('A ve existencia / cambio esperado', [await panel(A).locator('tbody tr td:nth-child(2)').allInnerTexts(), await panel(A).locator('input[formcontrolname=quantityChange]').evaluateAll((e) => e.map((x) => x.placeholder))]);
  await snap(A, '21-inv-obsoleto-antes');
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
  await ctxB.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const B = await ctxB.newPage(); await uiLogin(B); await go(B, 'inventory/adjustments');
  const d2 = await draft(B, [{ productId: P.TOR, quantityChange: -10 }], { reason: 'QA-7734 sesión B merma' });
  const p2 = await api(B, 'POST', `/inventory/adjustments/${d2.body.id}/post`);
  out('B contabiliza', [p2.status, p2.body?.number, p2.body?.lines?.map((l) => [l.quantityBefore, l.quantityChange])]);
  await panel(A).getByRole('button', { name: 'Contabilizar' }).click(); await A.waitForTimeout(800);
  out('dialogo A', await A.locator('[role=dialog], [role=alertdialog]').last().innerText());
  await A.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: 'Contabilizar' }).last().click();
  await A.waitForTimeout(3000);
  await snap(A, '22-inv-obsoleto-despues');
  const r1 = await api(A, 'GET', `/inventory/adjustments/${d1.body.id}`);
  out('resultado A', r1.body.lines.map((l) => ({ antes: l.quantityBefore, contado: l.countedQuantity, cambio: l.quantityChange, valor: l.valueChange })));
  // Fechas
  for (const date of ['2019-01-15', '2031-06-01']) {
    const d = await draft(A, [{ productId: P.CAB, quantityChange: 1 }], { reason: 'QA-7734 fecha ' + date, date });
    const p = await api(A, 'POST', `/inventory/adjustments/${d.body.id}/post`);
    out('fecha ' + date, [d.status, d.body.number, p.status, JSON.stringify(p.body).slice(0, 300)]);
    if (date === '2019-01-15') {
      await go(A, `inventory/adjustments/${d.body.id}`); await A.waitForTimeout(2000);
      await snap(A, '26-inv-fecha-2019-borrador');
      if (p.status !== 201) { /* ya está */ }
    }
  }
  // Movimiento del kardex: ¿qué fecha lleva un ajuste con fecha 2031?
  const mv = await api(A, 'GET', '/inventory/movements?limit=50');
  out('kardex ultimas', mv.body.items.slice(-3).map((m) => [m.date, m.reference, m.quantity]));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
