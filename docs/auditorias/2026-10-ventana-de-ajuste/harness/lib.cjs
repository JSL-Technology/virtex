// Arnés de la auditoría de la ventana de ajuste: reutiliza el del QA y guarda capturas aquí.
const path = require('path');
const fs = require('fs');
process.env.QA_PASS = process.env.QA_PASS || 'QA-Ajuste-2026!';
const base = require('../../../qa/harness/lib.cjs');
// `CAP_DIR=capturas-despues` repite los mismos guiones para las capturas posteriores a las correcciones.
const CAP = path.resolve(__dirname, '..', process.env.CAP_DIR || 'capturas');
async function snap(page, name, opts = {}) {
  fs.mkdirSync(CAP, { recursive: true });
  await page.screenshot({ path: path.join(CAP, `${name}.png`), fullPage: !!opts.full, timeout: 15000, animations: 'disabled' }).catch((e) => console.log('snap fail', e.message));
  return `${path.basename(CAP)}/${name}.png`;
}
module.exports = { ...base, CAP, snap };
/** Llama a la API real con la sesión y el token CSRF del navegador. */
async function api(page, method, p, body) {
  return page.evaluate(async ({ method, p, body }) => {
    const tok = (document.cookie.match(/(?:^|; )(?:__Host-)?XSRF-TOKEN=([^;]+)/) || [])[1];
    const r = await fetch('http://localhost:3000/api/v1' + p, { method, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(tok ? { 'X-XSRF-TOKEN': decodeURIComponent(tok) } : {}) }, body: body ? JSON.stringify(body) : (method === 'GET' ? undefined : '{}') });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  }, { method, p, body });
}
module.exports.api = api;
