// Contabilidad: asiento manual — vacío, descuadrado, débito+crédito en la misma línea, negativo, fecha futura,
// válido; luego lo abre desde la lista y prueba sus acciones (editar / anular sobre el asiento QA).
const { launch, instrument, uiLogin, shot, go, fill, click, panel, panelText, netSince, errorsShown, stepUp, toasts } = require('./lib.cjs');
async function vxPick(page, loc, text) { await loc.click({ force: true }); if (text) await page.keyboard.type(text, { delay: 30 }); await page.waitForTimeout(1300); const opts = await page.locator('[role=option]').allInnerTexts(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(600); return opts; }
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); console.log(`[${name}] url=${page.url().split('/e/')[1]} errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n))}`); await shot(page, `f-je-${name}`); };
  const setLines = async (lines) => {
    const rows = p.locator('tbody tr');
    for (let i = 0; i < lines.length; i++) {
      if (i >= (await rows.count())) await click(page, 'Añadir línea', { wait: 500 });
      const r = rows.nth(i);
      if (lines[i].acc) console.log(`CUENTA-${i}`, (await vxPick(page, r.locator('input[role=combobox]').first(), lines[i].acc)).slice(0, 3));
      const nums = r.locator('input[type=number]');
      await nums.nth(0).fill(String(lines[i].d)); await nums.nth(1).fill(String(lines[i].c));
    }
    await page.waitForTimeout(600);
    console.log('TOTALES', (await panelText(page)).match(/Totales:[^\n]*\n?[^\n]*/)?.[0]?.replace(/\n/g, ' '));
  };
  await go(page, 'accounting/journal-entries/new');
  const sels = await p.locator('select').evaluateAll((ss) => ss.map((s) => [...s.options].map((o) => o.text.trim())));
  console.log('SELECTS', JSON.stringify(sels));
  await step('1-vacio', async () => { await click(page, 'Guardar asiento'); });
  await step('2-descuadrado', async () => {
    await p.locator('select').nth(0).selectOption({ index: 1 }); await p.locator('select').nth(1).selectOption({ index: 1 });
    await fill(page, 'Descripción', 'QA-Asiento descuadrado');
    await setLines([{ acc: '5900', d: 100, c: 0 }, { acc: '1120', d: 0, c: 50 }]);
    await click(page, 'Guardar asiento');
  });
  await step('3-deb-y-cred-misma-linea', async () => { await setLines([{ d: 100, c: 100 }, { d: 0, c: 0 }]); await click(page, 'Guardar asiento'); });
  await step('4-negativo', async () => { await setLines([{ d: -100, c: 0 }, { d: 0, c: -100 }]); await click(page, 'Guardar asiento'); });
  await step('5-fecha-futura', async () => { await fill(page, 'Fecha', '2031-01-15'); await setLines([{ d: 1500, c: 0 }, { d: 0, c: 1500 }]); await click(page, 'Guardar asiento'); console.log('TOAST', (await toasts(page)).slice(-200)); });
  await go(page, 'accounting/journal-entries/new');
  await step('6-valido', async () => {
    await fill(page, 'Fecha', '2026-09-28');
    await fill(page, 'Descripción', 'QA-Asiento manual: gasto de oficina pagado por banco <b>ñ</b>');
    await setLines([{ acc: '5900', d: 1500, c: 0 }, { acc: '1120', d: 0, c: 1500 }]);
    await click(page, 'Guardar asiento');
    console.log('STEPUP', JSON.stringify(await stepUp(page)));
    console.log('TOAST', (await toasts(page)).slice(-200));
  });
  await go(page, 'accounting/journal-entries');
  await step('7-lista', async () => { console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 900)); await p.getByText(/QA-Asiento manual/).first().click(); await page.waitForTimeout(2000); });
  await step('8-detalle', async () => { console.log((await panelText(page)).replace(/\n+/g, ' | ').slice(0, 900)); console.log('BOTONES', JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean))); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
