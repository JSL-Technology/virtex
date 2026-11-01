const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts, errorsShown, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1800); const k = await stepUpAll(page); console.log(`[${name}] stepups=${k} url=${page.url().split('/e/')[1]} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-250)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n)).slice(0, 900)}`); await shot(page, `cp-${name}`); };
  // Cuenta contable nueva + editar
  await go(page, 'accounting/chart-of-accounts/new');
  await step('coa-0', async () => { console.log('   FORM', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 1200)); console.log('   CTRLS', JSON.stringify(await p.locator('input, select, textarea').evaluateAll((es) => es.filter((e) => e.offsetWidth).map((e) => `${e.getAttribute('formcontrolname') || e.type}${e.tagName === 'SELECT' ? '{' + [...e.options].map((o) => o.text.trim()).join('|').slice(0, 200) + '}' : ''}`)))); });
  await go(page, 'accounting/chart-of-accounts');
  await step('coa-lista', async () => { console.log('   LISTA', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 800)); console.log('   BOTONES', JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean).slice(0, 30))); });
  await go(page, 'accounting/periods');
  await step('per-lista', async () => { console.log('   PER', (await panelText(page)).replace(/\s+/g, ' ').slice(0, 1500)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
