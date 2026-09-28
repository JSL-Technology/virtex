// Ajustes con contenido: Mi Perfil (nombre, contraseña: incorrecta/débil/válida y revertir, 2FA abrir), Perfil de la Empresa,
// Estructura, Personalización, Facturación y Plan, SSO. Registra red y mensajes.
const { launch, instrument, uiLogin, shot, netSince, stepUpAll, toasts } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const dlg = () => page.locator('[role=dialog]').first();
  const open = async (h) => { await page.evaluate((x) => { location.hash = x; }, `settings/${h}`); await page.waitForTimeout(1800); };
  const content = async () => (await dlg().innerText()).split('SSO').slice(1).join('SSO').replace(/\n+/g, ' | ');
  const step = async (name, fn) => { const n = log.requests.length; try { await fn(); } catch (e) { console.log(`[${name}] EXC ${e.message.split('\n')[0]}`); } await page.waitForTimeout(1500); const su = await stepUpAll(page); if (su) await page.waitForTimeout(1500); console.log(`[${name}] stepups=${su} toast="${(await toasts(page)).split('|').map((x) => x.trim()).filter((x) => x && !/Virtex Dev|Periodo|Conectado/.test(x)).slice(-2).join(' / ').slice(0, 200)}"\n   red=${netSince(log, n).map((x) => x.slice(0, 170)).join(' ; ').slice(0, 800)}`); await shot(page, `f-set-${name}`); };
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  const S = async (name, fn) => { if (!only || only.test(name)) await step(name, fn); };
  // Mi perfil
  await open('my-profile');
  console.log('PERFIL', (await content()).slice(0, 900));
  const d = dlg();
  await S('perfil-nombre', async () => { const i = d.locator('[formcontrolname=firstName]'); await i.fill('Dev QA'); await d.getByRole('button', { name: 'Guardar Cambios' }).click(); });
  await S('perfil-nombre-vacio', async () => { await d.locator('[formcontrolname=firstName]').fill(''); await d.getByRole('button', { name: 'Guardar Cambios' }).click(); });
  await S('perfil-nombre-restaurar', async () => { await d.locator('[formcontrolname=firstName]').fill('Dev'); await d.getByRole('button', { name: 'Guardar Cambios' }).click(); });
  const pw = d.locator('input[type=password]');
  console.log('PW-INPUTS', await pw.count(), JSON.stringify(await pw.evaluateAll((es) => es.map((e) => e.getAttribute('formcontrolname') || e.placeholder))));
  const setPw = async (cur, nw, conf) => { await pw.nth(0).fill(cur); await pw.nth(1).fill(nw); if ((await pw.count()) > 2) await pw.nth(2).fill(conf); const b = d.getByRole('button', { name: 'Actualizar Contraseña' }); console.log('   btn-deshabilitado', await b.isDisabled()); if (!(await b.isDisabled())) await b.click(); };
  await S('pw-actual-incorrecta', async () => setPw('incorrecta-999', 'QA-Nueva-Pass-2026!', 'QA-Nueva-Pass-2026!'));
  await S('pw-debil', async () => setPw('QA-Test-Pass-2026', 'abc', 'abc'));
  await S('pw-no-coincide', async () => setPw('QA-Test-Pass-2026', 'QA-Nueva-Pass-2026!', 'QA-Otra-2026!'));
  await S('2fa-activar', async () => { await d.getByRole('button', { name: 'Activar' }).click(); await page.waitForTimeout(1500); console.log('   2FA', (await page.locator('[role=dialog]').last().innerText()).replace(/\n+/g, ' | ').slice(-400)); await page.keyboard.press('Escape'); });
  await S('cambiar-correo', async () => { await d.getByRole('button', { name: 'Cambiar correo' }).click(); await page.waitForTimeout(1200); console.log('   CORREO', (await page.locator('[role=dialog]').last().innerText()).replace(/\n+/g, ' | ').slice(-300)); await page.keyboard.press('Escape'); });
  for (const h of ['profile', 'subsidiaries', 'branding', 'billing', 'sso']) {
    await open(h);
    await S(`sec-${h}`, async () => { console.log(`   ${h}:`, (await content()).slice(0, 700)); console.log('   BOTONES', JSON.stringify((await dlg().getByRole('button').allInnerTexts()).map((x) => x.trim()).filter(Boolean).slice(20))); });
  }
  await open('profile');
  await S('empresa-guardar-sin-cambios', async () => { const b = dlg().getByRole('button', { name: /Guardar/ }).last(); console.log('   deshabilitado', await b.isDisabled()); if (!(await b.isDisabled())) await b.click(); });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
