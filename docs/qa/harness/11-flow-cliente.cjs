// Flujo Inventario: alta de producto (vacío, inválido, límites, largo, especiales, válido, doble clic).
const { launch, instrument, uiLogin, shot, go, fill, click, panelText, netSince, toasts, errorsShown } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.dismiss(); });
  await uiLogin(page);
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1200); console.log(`[${name}] url=${page.url().split('/e/')[1]} toasts="${await toasts(page)}" errores=${JSON.stringify(await errorsShown(page))}\n   red=${JSON.stringify(netSince(log, n))}`); await shot(page, `f-cli-${name}`); };

  await go(page, 'contacts/customers/new');
  const selects = await page.locator('.dv-groupview.dv-active-group select').evaluateAll((ss) => ss.map((s) => [s.previousElementSibling?.innerText || s.getAttribute('formcontrolname'), [...s.options].map((o) => o.text.trim())]));
  console.log('SELECTS', JSON.stringify(selects));
  await step('1-vacio', async () => { await click(page, 'Guardar cliente'); });
  await step('2-invalidos', async () => { await fill(page, 'Nombre del cliente', 'QA-Cli-Inv'); await fill(page, 'Correo Electrónico', 'no-es-correo'); await fill(page, 'Número de documento', 'ABC-123'); await fill(page, 'Días de crédito', '-10'); await click(page, 'Guardar cliente'); });
  await go(page, 'contacts/customers/new');
  await step('3-valido', async () => {
    await fill(page, 'Nombre del cliente', 'QA-Cliente-01 Distribuidora Ñandú & Hijos');
    await fill(page, 'Persona de Contacto', 'María José Pérez');
    if (!process.env.NODOC) await fill(page, 'Número de documento', '101010101');
    await fill(page, 'Correo Electrónico', 'qa-cliente01@example.com');
    await fill(page, 'Línea de Dirección', 'Av. Winston Churchill #1, Piso 2');
    await fill(page, 'Ciudad', 'Santo Domingo');
    await fill(page, 'Días de crédito', '30');
    await fill(page, 'País', 'República Dominicana');
    await click(page, 'Guardar cliente');
  });
  await go(page, 'contacts/customers');
  await step('4-lista', async () => { console.log((await panelText(page)).slice(0, 700)); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

