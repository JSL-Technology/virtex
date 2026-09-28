// Ajustes → Usuarios: invitar (inválido, cancelar con datos, válido SELLER/ACCOUNTANT, duplicado).
const { launch, instrument, uiLogin, shot, netSince, stepUpAll, toasts } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  await page.evaluate(() => { location.hash = 'settings/users'; }); await page.waitForTimeout(2000);
  const invite = async (tag, email, role, action = 'Enviar invitación') => {
    const n = log.requests.length;
    await page.getByRole('button', { name: /Invitar Usuario/ }).click(); await page.waitForTimeout(1000);
    const box = page.getByText('Invitar nuevo usuario').locator('xpath=ancestor::*[.//button[contains(., "Enviar invitación")]][1]');
    await box.locator('[formcontrolname=firstName]').fill('QA-' + (role || 'X'));
    await box.locator('[formcontrolname=lastName]').fill('Tester Ñ');
    await box.locator('input[type=email]').fill(email);
    if (role) { await box.getByPlaceholder('Seleccionar rol').click({ force: true }); await page.waitForTimeout(800); const opts = await page.locator('[role=option]').allInnerTexts(); if (tag === 'seller') console.log('ROLES', JSON.stringify(opts)); const idx = opts.findIndex((o) => o.trim() === role); for (let i = 0; i < idx; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(500); }
    const btn = box.getByRole('button', { name: action });
    const disabled = await btn.isDisabled();
    if (!disabled) await btn.click();
    await page.waitForTimeout(1800);
    console.log(`[${tag}] deshabilitado=${disabled} stepups=${await stepUpAll(page)} red=${JSON.stringify(netSince(log, n)).slice(0, 600)} toast="${(await toasts(page)).split('|').pop().trim().slice(0, 160)}"`);
    await shot(page, `f-inv-${tag}`);
    if (await page.getByText('Invitar nuevo usuario').count()) { await box.getByRole('button', { name: 'Cancelar' }).click().catch(() => {}); await page.waitForTimeout(600); }
  };
  await invite('seller2', 'qa-vendedor@example.com', 'SELLER');
  await invite('accountant2', 'qa-contador@example.com', 'ACCOUNTANT');
  await invite('member', 'qa-miembro@example.com', 'MEMBER');
  await page.getByRole('button', { name: /Pendiente/ }).click().catch(() => {}); await page.waitForTimeout(1200);
  console.log('PENDIENTES', (await page.locator('[role=dialog]').first().innerText()).split('ACCIONES')[1]?.replace(/\n+/g, ' | ').slice(0, 600));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
