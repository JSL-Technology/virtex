// QA HTTP client: node qa-client.mjs <email> <METHOD> <path> [jsonBody]
// Logs in (cookie session + CSRF double-submit), caches cookies per email in ./sessions/, prints status + body.
// Base URL: QA_API (default http://localhost:3000/api/v1). Password: QA_PASSWORD (required; the one the QA tenants were created with).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sessions'); fs.mkdirSync(dir, { recursive: true });
const API = process.env.QA_API ?? 'http://localhost:3000/api/v1';
const [email, method = 'GET', p = '/auth/session', body] = process.argv.slice(2);
const file = path.join(dir, (process.env.QA_SESSION ? process.env.QA_SESSION + '__' : '') + email.replace(/[^a-z0-9]/gi, '_') + '.json');
let jar = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const save = () => fs.writeFileSync(file, JSON.stringify(jar));
function absorb(res) { for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v === '' || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) delete jar[k]; else jar[k] = v; } save(); }
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const csrf = () => jar['__Host-XSRF-TOKEN'] ?? jar['XSRF-TOKEN'];
async function call(m, u, b) {
  const h = { cookie: cookie(), 'accept-language': process.env.QA_LANG ?? 'es' }; if (b !== undefined) h['content-type'] = 'application/json'; if (csrf()) h['x-xsrf-token'] = csrf(); Object.assign(h, JSON.parse(process.env.QA_HEADERS || '{}'));
  const r = await fetch(API + u, { method: m, headers: h, body: b === undefined ? undefined : (typeof b === 'string' ? b : JSON.stringify(b)) }); absorb(r); return r;
}
function requiredPassword() { const p = process.env.QA_PASSWORD; if (!p) { console.error('Set QA_PASSWORD (the QA tenants\' password).'); process.exit(2); } return p; }
async function ensureLogin() {
  let r = await call('GET', '/auth/session'); const s = await r.json().catch(() => ({}));
  if (s.authenticated) return;
  if (s.refreshable) { r = await call('POST', '/auth/refresh', {}); if (r.ok) return; }
  r = await call('POST', '/auth/login', { email, password: requiredPassword(), rememberMe: false });
  if (!r.ok) { console.error('LOGIN FAILED', r.status, await r.text()); process.exit(2); }
  await call('GET', '/auth/session');
}
await ensureLogin();
const r = await call(method.toUpperCase(), p, body);
const t = await r.text(); console.log(`HTTP ${r.status} ${method} ${p}`); console.log(t.length > 6000 && !process.env.QA_FULL ? t.slice(0, 6000) + `\n…[truncated ${t.length} chars; QA_FULL=1 for all]` : t);
