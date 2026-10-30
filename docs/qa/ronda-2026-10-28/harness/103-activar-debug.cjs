const fs = require('fs'); const path = require('path');
const { launch, BASE } = require('./lib.cjs');
const OUT = '/home/user/virtex/tmp/mail-outbox';
(async () => {
  const f = fs.readdirSync(OUT).filter((x) => /invitaron.*\.json$/.test(x)).map((x) => JSON.parse(fs.readFileSync(path.join(OUT, x)))).filter((d) => d.to[0].address === (process.env.EMAIL || 'qa3-activa@example.com')).pop();
  const url = Object.values(f.context).find((v) => typeof v === 'string' && v.includes('set-password'));
  const { browser, context } = await launch(); const page = await context.newPage();
  page.on('framenavigated', (fr) => { if (fr === page.mainFrame()) console.log('NAV', fr.url().replace(BASE, '')); });
  page.on('response', async (r) => { const u = r.url(); if (!u.includes('/api/')) return; let b = ''; if (/set-password|auth\/session|organizations/.test(u)) { try { b = (await r.text()).slice(0, 700); } catch {} } console.log('API', r.request().method(), u.replace('http://localhost:3000/api/v1', ''), r.status(), b); });
  await page.goto(url); await page.locator('input[type=password]').first().waitFor({ timeout: 45000 });
  const pw = page.locator('input[type=password]'); await pw.nth(0).fill('QA3-Pass-Segura-2026!'); await pw.nth(1).fill('QA3-Pass-Segura-2026!');
  await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(12000);
  console.log('FINAL', page.url().replace(BASE, ''));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
