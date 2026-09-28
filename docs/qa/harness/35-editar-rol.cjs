// Ajustes → Usuarios: menú de acciones por fila y cambio de rol.
const { launch, instrument, uiLogin, shot, netSince, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  await page.evaluate(() => { location.hash = 'settings/users'; }); await page.waitForTimeout(2000);
  const setRole = async (email, role) => {
    const row = page.locator('tr').filter({ hasText: email });
    await row.locator('button').last().click(); await page.waitForTimeout(800);
    const menu = await page.locator('[role=menu], [role=menuitem], .cdk-overlay-pane, [class*=dropdown-menu]').allInnerTexts();
    console.log('MENU', JSON.stringify(menu).slice(0, 300));
    await shot(page, `f-rol-menu-${role}`);
    const edit = page.getByRole('menuitem', { name: /rol|Editar/i }).or(page.getByText(/Cambiar rol|Editar/)).first();
    const n = log.requests.length;
    await edit.click(); await page.waitForTimeout(1200);
    await shot(page, `f-rol-form-${role}`);
    const combo = page.getByPlaceholder(/Seleccionar rol/).last();
    if (await combo.count()) { await combo.click({ force: true }); await page.waitForTimeout(600); const opts = await page.locator('[role=option]').allInnerTexts(); const idx = opts.findIndex((o) => o.trim() === role); await page.locator('[role=option]').nth(idx).hover(); await page.keyboard.press('Enter').catch(() => {}); await page.locator('[role=option]').nth(idx).click({ force: true }).catch(() => {}); }
    const sel = page.locator('[role=dialog] select').last(); if (!(await combo.count()) && (await sel.count())) await sel.selectOption({ label: role });
    await page.getByRole('button', { name: /Guardar|Actualizar|Confirmar/ }).last().click().catch((e) => console.log('noguardar', e.message.split('\n')[0]));
    await page.waitForTimeout(1500);
    console.log(`[${role}] stepups=${await stepUpAll(page)} red=${JSON.stringify(netSince(log, n)).slice(0, 500)}`);
    await page.waitForTimeout(1000);
  };
  await setRole('qa-seller@example.com', 'SELLER');
  await setRole('qa-accountant@example.com', 'ACCOUNTANT');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
