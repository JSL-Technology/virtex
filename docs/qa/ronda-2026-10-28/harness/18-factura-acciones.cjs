// Detalle de factura: cada botón de la barra, sus menús y efectos (descarga, impresión, diálogo, red).
const { launch, instrument, uiLogin, shot, go, panel, netSince, toasts } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; const o = window.open; window.__opened = []; window.open = (...a) => { window.__opened.push(String(a[0])); return null; }; });
  page.on('download', async (d) => console.log('DOWNLOAD', d.suggestedFilename()));
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.dismiss(); });
  await uiLogin(page);
  await go(page, 'invoices'); await page.waitForTimeout(1500);
  const p = panel(page);
  console.log('LISTA', (await p.innerText()).replace(/\s+/g, ' ').slice(0, 600));
  await p.locator('tbody tr').first().click(); await page.waitForTimeout(2500);
  const detailUrl = page.url();
  console.log('DETALLE', detailUrl);
  const names = (await p.getByRole('button').evaluateAll((bs) => bs.map((b) => (b.innerText.trim() || b.getAttribute('aria-label') || b.title || '?')))).filter((n) => (process.env.ONLYB ? new RegExp(process.env.ONLYB).test(n) : !/Nota de crédito|Anular|Registrar cobro/.test(n)));
  console.log('BOTONES', JSON.stringify(names));
  for (const name of names) {
    if (page.url() !== detailUrl) { await page.goto(detailUrl); await page.waitForTimeout(2500); }
    const n = log.requests.length;
    const before = { tabs: await page.locator('.dv-tab').count(), dlg: await page.locator('[role=dialog], [role=menu], .cdk-overlay-pane').count(), url: page.url() };
    const b = p.getByRole('button', { name, exact: true }).first();
    try { await b.click({ timeout: 3000 }); } catch (e) { console.log(`[${name}] no clicable: ${e.message.split('\n')[0]}`); continue; }
    await page.waitForTimeout(2000);
    const after = { tabs: await page.locator('.dv-tab').count(), dlg: await page.locator('[role=dialog], [role=menu], .cdk-overlay-pane').count(), url: page.url() };
    const extra = await page.evaluate(() => ({ printed: window.__printed, opened: window.__opened.slice(-2) }));
    const menu = await page.locator('[role=menu], [role=dialog], .cdk-overlay-pane').last().innerText().catch(() => '');
    console.log(`[${name}] url=${after.url !== before.url ? after.url.split('/e/')[1] : '='} tabs ${before.tabs}->${after.tabs} overlays ${before.dlg}->${after.dlg} print=${extra.printed} open=${JSON.stringify(extra.opened)} red=${JSON.stringify(netSince(log, n)).slice(0, 400)} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-150)}"\n    overlay="${after.dlg > before.dlg ? menu.replace(/\s+/g, ' ').slice(0, 400) : ''}"`);
    if (after.dlg > before.dlg) await shot(page, `facacc-${name.replace(/\W+/g, '_')}`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
