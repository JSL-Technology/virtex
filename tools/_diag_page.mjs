import puppeteer from 'puppeteer';

const URL = process.env.DIAG_URL || 'http://localhost:4200/';
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox'],
});

const page = await browser.newPage();
const consoleMsgs = [];
const pageErrors = [];
const failedReqs = [];
const pendingReqs = new Map();

page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('requestfailed', (r) => failedReqs.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
page.on('request', (r) => pendingReqs.set(r.url(), Date.now()));
page.on('requestfinished', (r) => pendingReqs.delete(r.url()));
page.on('response', (r) => pendingReqs.delete(r.url()));

let navResult = 'ok';
try {
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 20000 });
} catch (e) {
  navResult = 'NAV ERROR/TIMEOUT: ' + e.message;
}

// Give the SPA a moment, then measure if main thread is stuck
await new Promise((r) => setTimeout(r, 2000));

let evalResult = 'RESPONSIVE';
try {
  const t0 = Date.now();
  await Promise.race([
    page.evaluate(() => document.readyState),
    new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout - main thread busy')), 5000)),
  ]);
  evalResult = `RESPONSIVE (${Date.now() - t0}ms)`;
} catch (e) {
  evalResult = 'MAIN THREAD STUCK: ' + e.message;
}

let bodyLen = 'n/a', title = 'n/a', rootHtml = 'n/a';
try {
  title = await page.title();
  bodyLen = await page.evaluate(() => document.body?.innerText?.length ?? 0);
  rootHtml = await page.evaluate(() => (document.querySelector('app-root')?.innerHTML || '').slice(0, 200));
} catch {}

console.log('=== NAV ===', navResult);
console.log('=== MAIN THREAD ===', evalResult);
console.log('=== TITLE ===', title);
console.log('=== BODY TEXT LEN ===', bodyLen);
console.log('=== app-root (200 chars) ===', JSON.stringify(rootHtml));
console.log('\n=== PAGE ERRORS (' + pageErrors.length + ') ===');
pageErrors.slice(0, 30).forEach((e) => console.log(' •', e));
console.log('\n=== FAILED REQUESTS (' + failedReqs.length + ') ===');
failedReqs.slice(0, 30).forEach((e) => console.log(' •', e));
console.log('\n=== STILL-PENDING REQUESTS (' + pendingReqs.size + ') ===');
[...pendingReqs.entries()].slice(0, 30).forEach(([u, t]) => console.log(` • pending ${((Date.now() - t) / 1000).toFixed(1)}s: ${u}`));
console.log('\n=== CONSOLE (last 40 of ' + consoleMsgs.length + ') ===');
consoleMsgs.slice(-40).forEach((m) => console.log(' •', m));

await browser.close();
