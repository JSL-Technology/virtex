const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; const o = window.open; window.open = (...a) => { window.__opens = (window.__opens || []).concat([String(a[0])]); return null; }; });
  await uiLogin(page);
  const p = panel(page);
  await go(page, 'invoices'); await p.getByText('FAC-00000001').first().click(); await page.waitForTimeout(2000);
  for (const nm of ['Imprimir', 'Exportar a PDF', 'Enviar por correo']) { await p.getByRole('button', { name: nm, exact: true }).click(); await page.waitForTimeout(1200); }
  console.log('PRINTS', await page.evaluate(() => window.__prints), 'OPENS', JSON.stringify(await page.evaluate(() => window.__opens || [])));
  for (const nm of ['Copiar de', 'Copiar a']) {
    const n = log.requests.length;
    await p.getByRole('button', { name: new RegExp(`^\\s*${nm}`) }).first().click(); await page.waitForTimeout(1500);
    console.log(nm, 'MENU/DIALOGO:', (await page.locator('[role=menu], [role=dialog], .cdk-overlay-pane').allInnerTexts()).join(' / ').replace(/\n+/g, ' ').slice(0, 300), 'URL', page.url().split('/e/')[1], 'RED', JSON.stringify(netSince(log, n)));
    await shot(page, `f-fa-${nm.replace(/ /g, '')}`);
    const opt = page.locator('[role=menuitem], [role=dialog] button, .cdk-overlay-pane button').first();
    if (await opt.count()) { const t = await opt.innerText(); await opt.click(); await page.waitForTimeout(2000); console.log('  opcion', t, '->', page.url().split('/e/')[1], (await panelText(page)).replace(/\n+/g, ' | ').slice(0, 200)); }
    await page.keyboard.press('Escape'); await go(page, 'invoices'); await p.getByText('FAC-00000001').first().click(); await page.waitForTimeout(1500);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
