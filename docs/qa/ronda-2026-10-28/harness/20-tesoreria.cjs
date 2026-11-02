// Tesorería: cuenta bancaria (vacío, inválidos, saldo inicial, IBAN), lista y posición.
const { launch, instrument, uiLogin, shot, go, fill, click, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-250)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 1200)}`); await shot(page, `tes-${name}`); };
  const p = panel(page);
  await go(page, 'accounting/treasury/bank-accounts/new');
  if(0) await step('0', async () => { console.log('MONEDA', await p.locator('select[formcontrolname=currencyCode]').inputValue(), 'CTA', JSON.stringify(await p.locator('select[formcontrolname=glAccountId] option').allInnerTexts()), 'BANCOS', JSON.stringify(await p.locator('select[formcontrolname=bankId] option').allInnerTexts())); });
  if(0) await step('1-vacio', async () => { await click(page, 'Guardar'); });
  if(0) await step('2-invalidos', async () => { await fill(page, 'Nombre', 'QA3-Inv'); await p.locator('input[formcontrolname=iban]').fill('###'); await p.locator('input[formcontrolname=swiftBic]').fill('!!'); await p.locator('input[formcontrolname=openingBalance]').fill('-500'); await click(page, 'Guardar'); });
  await step('3-valido-saldo', async () => {
    await p.locator('input[formcontrolname=iban]').fill(''); await p.locator('input[formcontrolname=swiftBic]').fill('');
    await fill(page, 'Nombre', 'QA3-6620-Banco operativo');
    await p.locator('input[formcontrolname=bankName]').fill('Banco QA3');
    await p.locator('input[formcontrolname=accountNumber]').fill('9600066201');
    await p.locator('select[formcontrolname=accountType]').selectOption({ label: 'Corriente' });
    await p.locator('select[formcontrolname=currencyCode]').selectOption('DOP');
    await p.locator('select[formcontrolname=glAccountId]').selectOption({ index: 2 });
    await p.locator('input[formcontrolname=openingBalance]').fill('50000');
    await page.waitForTimeout(800);
    await p.locator('select').filter({ hasText: 'Patrimonio por Saldos Iniciales' }).selectOption({ label: '3150 — Patrimonio por Saldos Iniciales' });
    console.log('FECHA-APERTURA', await p.locator('input[type=date]').first().inputValue());
    console.log('TRAS-SALDO', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 900));
    await click(page, 'Guardar');
  });
  await go(page, 'accounting/treasury');
  await step('4-posicion', async () => { console.log((await panelText(page)).replace(/\s+/g, ' ').slice(0, 900)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
