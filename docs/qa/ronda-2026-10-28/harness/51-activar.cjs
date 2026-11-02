// set-password: contraseña débil, no coincidente, válida; dónde aterriza; para cada invitado.
const fs = require('fs'); const path = require('path');
const { launch, instrument, shot, netSince, toasts, BASE } = require('./lib.cjs');
const OUT = '/home/user/virtex/tmp/mail-outbox';
(async () => {
  const { browser } = await launch();
  const links = fs.readdirSync(OUT).filter((f) => /invitaron.*\.json$/.test(f)).map((f) => { const d = JSON.parse(fs.readFileSync(path.join(OUT, f))); return [d.to[0].address, Object.values(d.context).find((v) => typeof v === 'string' && v.includes('set-password'))]; });
  let first = true;
  for (const [email, url] of links) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await context.newPage(); const log = instrument(page);
    await page.goto(url); await page.locator('input[type=password]').first().waitFor({ timeout: 45000 }).catch(() => {}); 
    const pw = page.locator('input[type=password]');
    if (first) {
      console.log('FORM', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 500));
      await pw.nth(0).fill('abc'); await pw.nth(1).fill('abc'); await page.waitForTimeout(500);
      const btn = page.locator('button[type=submit]').first();
      console.log('[debil] deshab', await btn.isDisabled(), 'msg', (await page.locator('body').innerText()).match(/(mínimo|caracteres|mayúscula|requisit|débil|segura)[^\n]{0,120}/gi));
      await shot(page, 'act-debil');
      await pw.nth(0).fill('QA3-Pass-Segura-2026!'); await pw.nth(1).fill('QA3-Pass-Distinta-2026!'); await page.waitForTimeout(500);
      console.log('[no-coincide] deshab', await btn.isDisabled(), 'msg', (await page.locator('body').innerText()).match(/(coincid)[^\n]{0,80}/gi));
      first = false;
    }
    await pw.nth(0).fill('QA3-Pass-Segura-2026!'); await pw.nth(1).fill('QA3-Pass-Segura-2026!');
    const t0 = Date.now(); const n = log.requests.length;
    await page.locator('button[type=submit]').first().click();
    await page.waitForURL((u) => !u.pathname.includes('set-password'), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    console.log(`[${email}] ${Date.now() - t0}ms -> ${page.url().replace(BASE, '')} red=${JSON.stringify(netSince(log, n)).slice(0, 300)} body="${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200)}"`);
    await shot(page, `act-${email.split('@')[0]}`);
    await context.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
