// Arnés de la auditoría UX 2026-10-29. Solo entorno local.
const path = require('path'); const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:4200';
const EVID = path.resolve(__dirname, '..', 'evidence');
const ADMIN = { email: 'dev@virtex.local', password: 'QA-Test-Pass-2026' };
async function launch(opts = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, locale: opts.locale || 'es-ES', colorScheme: opts.colorScheme || 'light', deviceScaleFactor: opts.dpr || 1, isMobile: !!opts.isMobile, hasTouch: !!opts.isMobile, storageState: opts.storageState, reducedMotion: opts.reducedMotion });
  return { browser, context };
}
function instrument(page) {
  const log = { req: [], console: [], errors: [] };
  page.on('response', async (res) => { const u = res.url(); if (!u.includes('/api/')) return; let body=''; if (res.status()>=400) { try { body=(await res.text()).slice(0,300);} catch{} } log.req.push(`${res.request().method()} ${u.replace(/.*\/api\/v1/,'')} ${res.status()} ${body}`); });
  page.on('console', (m) => { if (['error','warning'].includes(m.type())) log.console.push(m.type()+': '+m.text().slice(0,250)); });
  page.on('pageerror', (e) => log.errors.push(String(e).slice(0,300)));
  return log;
}
function resetThrottle() { try { require('child_process').execSync("redis-cli --scan --pattern '*throttl*' | xargs -r redis-cli del; redis-cli --scan --pattern '{*:default}:*' | xargs -r redis-cli del", { stdio: 'ignore' }); } catch {} }
async function login(page, creds = ADMIN, lang = 'es') {
  resetThrottle();
  await page.goto(`${BASE}/${lang}/auth/login`, { waitUntil: 'load' });
  await page.locator('input[type=password]').first().waitFor({ timeout: 30000 });
  await page.locator('input[type=email], input[formcontrolname=email]').first().fill(creds.email);
  await page.locator('input[type=password]').first().fill(creds.password);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/auth/'), { timeout: 30000 });
  await page.waitForTimeout(2500);
}
async function shot(page, name, full = false) {
  const f = path.join(EVID, `${name}.png`);
  await page.screenshot({ path: f, fullPage: full, timeout: 15000 }).catch((e) => console.log('shot fail', name, e.message));
  return f;
}
module.exports = { BASE, ADMIN, EVID, launch, instrument, login, shot, resetThrottle, fs, path };
