// Activación de cuenta invitada: débil, no coincide, válida; luego login con el usuario.
const { launch, instrument, shot, netSince, BASE, uiLogin } = require('./lib.cjs');
(async () => {
  const [email, token] = process.argv.slice(2);
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await page.goto(`${BASE}/es/auth/set-password#token=${token}`, { waitUntil: 'load' }); await page.waitForTimeout(2500);
  console.log('PAGINA', (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 400));
  const pw = page.locator('input[type=password]');
  console.log('PW-INPUTS', await pw.count());
  const attempt = async (tag, a, b) => {
    const n = log.requests.length;
    await pw.nth(0).fill(a); if ((await pw.count()) > 1) await pw.nth(1).fill(b);
    const btn = page.getByRole('button', { name: /Establecer|Guardar|Activar|Crear|Continuar|Confirmar/ }).last();
    const dis = await btn.isDisabled().catch(() => 'n/a');
    if (dis !== true) await btn.click().catch(() => {});
    await page.waitForTimeout(tag === 'valida' ? 15000 : 2500);
    const msgs = (await page.locator('[class*=error], [role=alert], .invalid-feedback, small').allInnerTexts()).filter(Boolean).slice(0, 4);
    console.log(`[${tag}] deshabilitado=${dis} url=${page.url().replace(BASE, '')} red=${JSON.stringify(netSince(log, n)).slice(0, 400)} msgs=${JSON.stringify(msgs)}`);
    await shot(page, `f-setpw-${tag}-${email.split('@')[0]}`);
  };
  if (!process.env.ONLY_VALID) { await attempt('debil', '123', '123'); await attempt('no-coincide', 'QA-Valid-Pass-2026!', 'QA-Otra-Pass-2026!'); }
  await attempt('valida', 'QA-Valid-Pass-2026!', 'QA-Valid-Pass-2026!');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
