// Ajustes: Mi perfil (guardar), cambiar contraseña (sin actual, débil, no coincide), 2FA, subsidiarias, sucursal, plan.
const { launch, instrument, uiLogin, shot, netSince, toasts, stepUpAll } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  process.env.STEPUP_PASS = 'QA3-Pass-Segura-2026!';
  await uiLogin(page, { email: 'qa3-contador@example.com', password: 'QA3-Pass-Segura-2026!' });
  const sec = async (s) => { await page.evaluate(() => { location.hash = ''; }); await page.waitForTimeout(200); await page.evaluate((h) => { location.hash = 'settings/' + h; }, s); await page.waitForTimeout(2200); return page.locator('[role=dialog]').first(); };
  const out = async (name, n) => { console.log(`[${name}] red=${JSON.stringify(netSince(log, n)).slice(0, 500)} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-200)}"`); await shot(page, `set-${name}`); };
  let d = await sec('my-profile');
  const main = d.locator('main, .sm-body, [class*=content]').last();
  console.log('CTRLS', JSON.stringify(await d.locator('input, select').evaluateAll((es) => es.filter((e) => e.offsetWidth).map((e) => `${e.type}:${e.getAttribute('formcontrolname') || e.name || e.id}=${e.value}`))));
  let n = log.requests.length;
  if (0) await d.locator('[formcontrolname=firstName]').fill('QA3 Contador'); await d.locator('[formcontrolname=lastName]').fill('Editado-9921');
  const save = d.getByRole('button', { name: 'Guardar cambios' }).last(); console.log('guardar deshab', await save.isDisabled());
  
  // contraseña
  const pw = d.locator('input[type=password]'); console.log('pw inputs', await pw.count());
  n = log.requests.length; await pw.nth(1).fill('abc'); await pw.nth(2).fill('abc'); const chg = d.getByRole('button', { name: /Cambiar contraseña|Actualizar contraseña/ }); console.log('chg deshab (débil)', await chg.isDisabled().catch(() => '?'), (await d.innerText()).match(/(requisit|mínimo|caracteres|no coincid)[^\n]{0,80}/gi));
  await pw.nth(1).fill('QA3-Nueva-Segura-2026!'); await pw.nth(2).fill('QA3-Nueva-Segura-2026!'); console.log('chg deshab (sin actual)', await chg.isDisabled().catch(() => '?'));
  await pw.nth(0).fill('incorrecta-xyz'); if (!(await chg.isDisabled().catch(() => true))) { await chg.click(); await page.waitForTimeout(2500); await stepUpAll(page); await page.waitForTimeout(1500); } await out('pass-actual-mala', n); console.log('   msgs', JSON.stringify((await d.innerText()).match(/(incorrect|no coincide|actual)[^\n]{0,90}/gi)));
  // 2FA
  n = log.requests.length; const tfa = d.getByRole('button', { name: /Activar|Configurar/ }).filter({ hasText: /2FA|factor|Activar/ }).first(); console.log('2fa btn', await tfa.count()); if (await tfa.count()) { await tfa.click(); await page.waitForTimeout(2500); await stepUpAll(page); await page.waitForTimeout(1500); } console.log('2FA UI', (await page.locator('[role=dialog]').last().innerText()).replace(/\s+/g, ' ').slice(0, 400)); await out('2fa', n);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
