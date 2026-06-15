const puppeteer = require('puppeteer');
const BASE = 'http://localhost:4200';

async function check(page, url, sel, typePw) {
  console.log('\n===== ' + url + ' =====');
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + (e.message || e)));
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
  catch (e) { console.log('goto: ' + e.message); }
  let rendered = false;
  try { await page.waitForSelector(sel, { timeout: 35000 }); rendered = true; }
  catch (e) { console.log('wait(' + sel + '): ' + e.message); }
  console.log('rendered: ' + rendered);

  if (typePw && rendered) {
    const pw = await page.$('input[type="password"]');
    if (pw) {
      await pw.click();
      await pw.type('Abcdefghij1!', { delay: 15 });
      await new Promise((r) => setTimeout(r, 1000));
      const checks = await page.$$eval('app-password-strength .pw-check', (e) => e.length).catch(() => -1);
      const met = await page.$$eval('app-password-strength .pw-check.met', (e) => e.length).catch(() => -1);
      console.log('password-strength checks: ' + checks + ' | met: ' + met);
    }
  }
  let alive = false;
  try {
    const r = await Promise.race([page.evaluate(() => 2 + 2), new Promise((_, j) => setTimeout(() => j(new Error('to')), 5000))]);
    alive = r === 4;
  } catch (_) {}
  console.log('thread alive: ' + alive + ' | pageerrors: ' + (errs.length ? errs.join(' | ') : 'none'));
  return rendered && alive;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const a = await check(page, BASE + '/es/auth/login', 'app-login form', false);
  const b = await check(page, BASE + '/es/do/auth/register', 'app-register form', true);
  console.log('\n==== RESULT: login=' + (a ? 'OK' : 'FAIL') + '  register=' + (b ? 'OK' : 'FAIL') + ' ====');
  await browser.close();
})();
