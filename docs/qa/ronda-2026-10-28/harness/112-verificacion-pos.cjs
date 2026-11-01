// Re-verificación en la app de caja (R3-B09): nombre de la caja por defecto y cierre con
// diferencia que exige justificación.
const { launch, shot, ADMIN } = require('./lib.cjs');
const POS = 'http://localhost:4300';
const out = (id, data) => console.log(JSON.stringify({ id, ...data }));

(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await page.goto(POS + '/login');
  await page.waitForTimeout(2500);
  await page.locator('input[type=email], input[autocomplete=username]').first().fill(ADMIN.email);
  await page.locator('input[type=password]').first().fill(ADMIN.password);
  await page.locator('button[type=submit]').first().click();
  await page.waitForTimeout(5000);
  const dlg = () => page.locator('[role=dialog], dialog[open]').last();

  // The chip names the till: «Caja principal», not the id «main».
  const chip = (await page.locator('.status .chip').first().innerText().catch(() => '')).trim();
  out('B09-nombre-caja', { chip, evidencia: await shot(page, 'r3fix-b09-caja') });

  // A shift to close: opened here, from the till's own panel, if there is none.
  const openShift = page.getByRole('button', { name: /^Abrir turno$/ });
  if (await openShift.count()) {
    await page.getByLabel(/Fondo de caja inicial/).fill('100');
    await openShift.click();
    await page.waitForTimeout(2500);
  }

  await page.keyboard.press('F7');
  await page.waitForTimeout(2000);
  const expectedText = (await dlg().innerText().catch(() => '')).replace(/\s+/g, ' ');
  const counted = page.locator('[data-testid=pos-counted-cash]');
  const close = page.locator('[data-testid=pos-confirm-close]');
  // The expected cash, read from the report the dialog shows, plus a surplus of 475.
  const expected = await page.evaluate(() => {
    const dd = [...document.querySelectorAll('dt')].find((dt) => /esperad/i.test(dt.textContent ?? ''))?.nextElementSibling;
    return Number((dd?.textContent ?? '0').replace(/[^\d.-]/g, ''));
  });
  await counted.fill(String(expected + 475));
  await page.waitForTimeout(600);
  const reason = page.locator('[data-testid=pos-variance-reason]');
  const result = {
    esperado: expected,
    campoMotivo: await reason.isVisible().catch(() => false),
    cerrarDeshabilitadoSinMotivo: await close.isDisabled(),
  };
  await reason.fill('QA3 sobrante: billete de 500 de un cobro con tarjeta');
  await page.waitForTimeout(400);
  result.cerrarHabilitadoConMotivo = !(await close.isDisabled());
  result.evidencia = await shot(page, 'r3fix-b09-cierre');
  await close.click();
  await page.waitForTimeout(2500);
  result.reporteZ = (await dlg().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
  result.dialogoAntes = expectedText.slice(0, 200);
  out('B09-cierre-justificado', result);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
