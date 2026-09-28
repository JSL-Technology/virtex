// Ajustes → Facturación electrónica: registro de rango e-NCF (vacío, invertido, negativo, válido, duplicado/solapado).
const { launch, instrument, uiLogin, shot, netSince, toasts } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  await page.evaluate(() => { location.hash = 'settings/fiscal'; });
  await page.waitForTimeout(2000);
  const dlg = page.locator('[role=dialog]').last();
  const sel = dlg.locator('select').first();
  const pre = dlg.locator('input[formcontrolname=prefix], input[name=prefix]').first();
  const from = dlg.locator('input[formcontrolname=startsAt], input[name=startsAt]').first();
  const to = dlg.locator('input[formcontrolname=endsAt], input[name=endsAt]').first();
  const btn = dlg.getByRole('button', { name: 'Registrar rango' });
  const attempt = async (name, t, p, a, b) => {
    const n = log.requests.length;
    if (t) await sel.selectOption({ label: t });
    await pre.fill(p); await from.fill(a); await to.fill(b);
    const dis = await btn.isDisabled();
    if (!dis) await btn.click();
    await page.waitForTimeout(1800);
    const msg = await dlg.locator('[class*=error], [role=alert], .invalid, small').allInnerTexts();
    console.log(`[${name}] botonDeshabilitado=${dis} red=${JSON.stringify(netSince(log, n))} msgs=${JSON.stringify(msg.filter(Boolean).slice(0, 4))} toast="${(await toasts(page)).slice(-160)}"`);
    await shot(page, `f-ncf-${name}`);
  };
  await attempt('1-vacio', null, '', '', '');
  await attempt('2-invertido', 'E31 · Factura de Crédito Fiscal Electrónica', 'E31', '100', '1');
  await attempt('3-negativo', null, 'E31', '-5', '10');
  await attempt('4-prefijo-invalido', null, 'ZZ<script>', '1', '10');
  await attempt('5-valido-E31', null, 'E31', '1', '500');
  await attempt('6-solapado-E31', null, 'E31', '100', '200');
  await attempt('7-valido-E32', 'E32 · Factura de Consumo Electrónica', 'E32', '1', '500');
  const txt = await dlg.innerText();
  console.log('RANGOS', txt.slice(txt.indexOf('Registrar rango'), txt.indexOf('Reportes DGII')).replace(/\n+/g, ' | '));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
