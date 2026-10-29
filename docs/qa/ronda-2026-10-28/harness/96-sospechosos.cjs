const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  page.on('dialog', (d) => { console.log('   NATIVE', d.message()); d.dismiss(); });
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page);
  const probe = async (route, name, nth = 0) => {
    await go(page, route); await page.waitForTimeout(2000);
    const tabs = await page.locator('.dv-tab').count(); const dl = await page.locator('[role=dialog]').count(); const html = (await panelText(page)).length; const n = log.requests.length;
    const b = p.getByRole('button', { name, exact: true }).nth(nth); if (!(await b.count())) { console.log(route, name, 'NO EXISTE'); return; }
    await b.click(); await page.waitForTimeout(2000);
    const after = (await panelText(page)); const d = page.locator('[role=dialog]').last();
    console.log(`${route} › ${name}[${nth}]: url=${page.url().split('/e/')[1]} tabs ${tabs}→${await page.locator('.dv-tab').count()} dlg ${dl}→${await page.locator('[role=dialog]').count()} Δtexto=${after.length - html} red=${JSON.stringify(netSince(log, n)).slice(0, 200)} dlgtxt=${(await d.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 150)} | ${after.replace(/\s+/g, ' ').slice(0, 250)}`);
    await shot(page, `sos-${route.replace(/\//g, '_')}-${name}`); await page.keyboard.press('Escape');
  };
  await probe('payroll/concepts', 'Editar', 0); await probe('payroll/concepts', 'Editar', 3);
  await probe('masters/currencies/exchange-rates', 'Importar'); await probe('masters/currencies/exchange-rates', 'Registrar tasa');
  await probe('inventory/categories', 'Retirar');
  await probe('workflows', 'Publicados 0'); await probe('workflow-tasks', 'Pendientes');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
