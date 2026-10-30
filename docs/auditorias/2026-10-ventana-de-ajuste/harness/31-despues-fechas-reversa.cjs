// Capturas «después» de las fechas fuera de período, la anulación de un borrador y la reversa de
// un ajuste contabilizado. Crea datos QA-7734 solo en local.
process.env.CAP_DIR = process.env.CAP_DIR || 'capturas-despues';
const { launch, instrument, uiLogin, snap, go, panel, panelText, api } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`);
const P = { CAB: 'da888aaa-a524-409e-8977-ec9c97007e36' };
const WN = '1688f859-df1f-4fdc-90c0-3a8feb63869d';
const POSTED = process.argv[2];

(async () => {
  const { browser, context } = await launch();
  const A = await context.newPage();
  instrument(A);
  await uiLogin(A);

  // 26/27 · Una fecha en un ejercicio cerrado y otra futura: el formulario lo dice antes de guardar.
  await go(A, 'inventory/adjustments/new');
  await A.waitForTimeout(2500);
  const date = panel(A).locator('#adj-date');
  for (const [value, name] of [['30/06/2019', '26-inv-fecha-2019-borrador'], ['10/08/2031', '27-inv-periodo-cerrado']]) {
    await date.fill(value);
    await date.blur();
    await A.waitForTimeout(1500);
    await snap(A, name);
    out(`aviso de fecha ${value}`, await panel(A).locator('#adj-date-period, #adj-date-error').allInnerTexts());
  }
  out('la API también lo rechaza', (await api(A, 'POST', '/inventory/adjustments', { date: '2031-08-10', warehouseId: WN, reason: 'QA-7734 futuro', lines: [{ productId: P.CAB, quantityChange: 1 }] })).status);

  // 28/29 · Anular un borrador.
  const draft = await api(A, 'POST', '/inventory/adjustments', { date: new Date().toISOString().slice(0, 10), warehouseId: WN, reason: 'QA-7734 para anular', lines: [{ productId: P.CAB, quantityChange: 1 }] });
  await go(A, `inventory/adjustments/${draft.body.id}`);
  await A.waitForTimeout(2200);
  await panel(A).getByRole('button', { name: /Anular/ }).first().click();
  await A.waitForTimeout(700);
  await snap(A, '28-inv-anular-dialogo');
  out('diálogo anular', await A.locator('[role=dialog], [role=alertdialog]').last().innerText());
  await A.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: /Anular/ }).last().click();
  await A.waitForTimeout(2500);
  await snap(A, '29-inv-anulado');
  out('texto anulado', (await panelText(A)).slice(0, 500));

  // 34/35 · Revertir un ajuste contabilizado: antes no había forma.
  if (POSTED) {
    await go(A, `inventory/adjustments/${POSTED}`);
    await A.waitForTimeout(2200);
    await panel(A).getByRole('button', { name: /Revertir/ }).first().click();
    await A.waitForTimeout(800);
    await snap(A, '34-inv-revertir-dialogo');
    out('diálogo revertir', await A.locator('[role=dialog], [role=alertdialog]').last().innerText());
    await A.locator('[role=dialog] textarea, [role=dialog] input[type=text], [role=alertdialog] textarea').first().fill('QA-7734 reversa de prueba').catch(() => {});
    await A.waitForTimeout(300);
    await A.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: /Revertir/ }).last().click();
    await A.waitForTimeout(3000);
    await snap(A, '35-inv-revertido');
    out('texto revertido', (await panelText(A)).slice(0, 600));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
