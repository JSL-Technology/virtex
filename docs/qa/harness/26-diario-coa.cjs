const { launch, instrument, uiLogin, shot, go, fill, click, panel, panelText, netSince, errorsShown, stepUp } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); console.log(`[${name}] url=${page.url().split('/e/')[1]} errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n))}\n   texto=${(await panelText(page)).replace(/\n+/g, ' | ').slice(0, 400)}`); await shot(page, `f-dc-${name}`); };
  await go(page, 'accounting/journals');
  await step('diario-editar', async () => { await p.getByText('Editar').first().click(); await page.waitForTimeout(2500); });
  await go(page, 'accounting/ledgers');
  await step('libro-editar', async () => { await p.getByText('Editar').first().click(); await page.waitForTimeout(2500); });
  await go(page, 'accounting/chart-of-accounts/new');
  await step('coa-valido', async () => {
    await fill(page, 'Código de Cuenta', '5910');
    await fill(page, 'Nombre de la Cuenta', 'QA-Gastos de prueba');
    await fill(page, 'Tipo de Cuenta', 'EXPENSE');
    await page.waitForTimeout(500);
    const cats = await (await require('./lib.cjs').field(page, 'Categoría')).evaluate((s) => [...s.options].map((o) => o.text.trim()));
    console.log('CATEGORIAS', JSON.stringify(cats));
    await (await require('./lib.cjs').field(page, 'Categoría')).selectOption({ index: 1 });
    await click(page, 'Guardar Cuenta');
    console.log('STEPUP', JSON.stringify(await stepUp(page)));
  });
  await go(page, 'accounting/chart-of-accounts');
  await step('coa-lista', async () => { const t = await panelText(page); console.log('TIENE-5910', t.includes('5910')); await p.getByText('1120').first().click(); await page.waitForTimeout(2000); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
