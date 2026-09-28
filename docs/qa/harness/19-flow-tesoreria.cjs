// Flujo Tesorería + Cobros: cuenta bancaria (vacío/inválido/válido con saldo inicial) y recibos de cliente
// (parcial y total) contra FAC-00000001. Verifica estado de la factura y asientos.
const { launch, instrument, uiLogin, shot, go, fill, click, panel, panelText, netSince, errorsShown, stepUp } = require('./lib.cjs');
async function vxPick(page, fieldLocator, text) {
  await fieldLocator.click({ force: true });
  if (text) { await page.keyboard.type(text, { delay: 30 }); }
  await page.waitForTimeout(1500);
  const opts = await page.locator('[role=option]').allInnerTexts();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  return opts;
}
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); console.log(`[${name}] url=${page.url().split('/e/')[1]} errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n))}`); await shot(page, `f-tes-${name}`); };
  const p = panel(page);
  if (!process.env.SKIP_BANK) {
    await go(page, 'accounting/treasury/bank-accounts/new');
    if (!process.env.CLEAN) await step('1-vacio', async () => { await click(page, 'Guardar', { exact: true }); });
    if (!process.env.CLEAN) await step('2-invalido', async () => { await fill(page, 'Nombre', 'QA-Banco-Inv'); await fill(page, 'Saldo inicial', '-500'); await fill(page, 'IBAN', '###'); await click(page, 'Guardar', { exact: true }); });
    await step('3-valido', async () => {
      await fill(page, 'Nombre', 'QA-Cuenta Corriente BHD');
      await fill(page, 'Banco', 'Banco BHD (QA)');
      await fill(page, 'Número', '0001234567');
      const selects = await p.locator('select').evaluateAll((ss) => ss.map((s) => [...s.options].map((o) => o.text.trim()).slice(0, 12)));
      console.log('SELECTS', JSON.stringify(selects));
      await fill(page, 'Moneda', 'DOP');
      await fill(page, 'Cuenta contable', 'Banco');
      if (!process.env.CLEAN) { await fill(page, 'Saldo inicial', '100000');
      await page.waitForTimeout(500);
      await fill(page, 'Fecha de apertura', '2026-09-01'); }
      const cp = await p.locator('select').last().evaluate((s) => [...s.options].map((o) => o.text.trim()));
      console.log('CONTRAPARTIDA', JSON.stringify(cp));
      if (!process.env.CLEAN) await fill(page, 'Cuenta de contrapartida', '3150').catch((e) => console.log('SIN-CONTRAPARTIDA', e.message));
      await click(page, 'Guardar', { exact: true });
      const nn = log.requests.length;
      console.log('STEPUP', JSON.stringify(await stepUp(page, { wrongFirst: !!process.env.WRONG })));
      await page.waitForTimeout(2500);
      console.log('RED-TRAS-STEPUP', JSON.stringify(netSince(log, nn)));
      console.log('TOAST-TRAS', (await page.locator('[role=alert], [class*=toast]').allInnerTexts()).join(' | ').slice(-300));
      await shot(page, 'f-tes-3c-tras-stepup');
    });
    if (!process.env.CLEAN) await step('3b-saldo-cero', async () => { await fill(page, 'Saldo inicial', '0'); await page.waitForTimeout(400); await click(page, 'Guardar', { exact: true }); });
    await go(page, 'accounting/treasury');
    await step('4-tablero', async () => { console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 900)); });
  }
  const receipt = async (tag, amount) => {
    await go(page, 'customer-receipts/new');
    await step(`${tag}-recibo`, async () => {
      const cli = p.getByPlaceholder(/Busca por nombre/).first();
      console.log('CLIENTES', await vxPick(page, cli, 'QA-Cliente'));
      const acc = p.getByPlaceholder(/Buscar o seleccionar/).first();
      console.log('CUENTAS', await vxPick(page, acc, ''));
      await fill(page, 'Monto recibido', amount);
      await page.waitForTimeout(800);
      console.log('FACTURAS-A-APLICAR', (await p.getByText('Facturas a aplicar').locator('..').innerText()).replace(/\n+/g, ' | '));
      await fill(page, 'Referencia', `QA-REF-${tag}`);
      await p.getByText('FAC-00000001').first().click().catch(() => {});
      await page.waitForTimeout(700);
      await p.locator('tbody tr').first().locator('input').first().fill(amount);
      await page.waitForTimeout(500);
      console.log('APLICADO', (await p.getByText('Facturas a aplicar').locator('..').innerText()).replace(/\n+/g, ' | '));
      await click(page, 'Guardar', { exact: true });
      console.log('STEPUP', JSON.stringify(await stepUp(page)));
    });
  };
  if (process.env.EMPTY_RECEIPT) { await go(page, 'customer-receipts/new'); await step('r0-vacio', async () => { await click(page, 'Guardar', { exact: true }); }); }
  await receipt('r1-parcial', '1000');
  await go(page, 'invoices');
  await step('r1-lista-facturas', async () => { console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 600)); });
  await receipt('r2-resto', '1360');
  await go(page, 'invoices');
  await step('r2-lista-facturas', async () => { console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 600)); });
  await go(page, 'customer-receipts');
  await step('r3-lista-recibos', async () => { console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 800)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
