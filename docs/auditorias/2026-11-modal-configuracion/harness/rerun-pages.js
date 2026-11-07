// Repite todas las fases de medición para unas páginas y combina el resultado con el de la pasada
// completa. Uso: node rerun-pages.js account-security,users
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pages = process.argv[2];
if (!pages) throw new Error('Indica las páginas: node rerun-pages.js a,b');
const R = path.join(__dirname, '..', 'salida', 'results');
const env = { ...process.env, VX_PASS: 'Evaluacion-UI-2026!' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (const ph of ['base', 'dark', 'laptop', 'phone', 'density', 'focus']) {
    const file = path.join(R, `${ph}.json`);
    const full = JSON.parse(fs.readFileSync(file, 'utf8'));
    execFileSync('node', ['run.js', 'login'], { cwd: __dirname, env });
    const out = execFileSync('node', ['run.js', ph, `--only=${pages}`], { cwd: __dirname, env, timeout: 900000 }).toString();
    console.log(`== ${ph}\n${out.trim().split('\n').slice(-pages.split(',').length).join('\n')}`);
    const part = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...full, ...part }, null, 2));
    await wait(10000);
  }
})().catch((e) => { console.error(e); process.exit(1); });
