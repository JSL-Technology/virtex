// Pasada final: cada fase con su propio inicio de sesión (el token de refresco rota en cada uso).
const { execFileSync } = require('child_process');
const env = { ...process.env, VX_PASS: 'Evaluacion-UI-2026!' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (args) => {
  try {
    const out = execFileSync('node', args, { cwd: __dirname, env, timeout: 1800000 }).toString();
    console.log(`== ${args.join(' ')}\n${out.trim().split('\n').slice(-30).join('\n')}`);
  } catch (e) {
    console.log(`== ${args.join(' ')} FAILED\n${String(e.stdout || '').slice(-2000)}\n${String(e.stderr || '').slice(-2000)}`);
  }
};
(async () => {
  for (const phase of [['run.js', 'base'], ['run.js', 'dark'], ['run.js', 'laptop'], ['run.js', 'phone'], ['run.js', 'density'], ['run.js', 'focus'], ['run.js', 'search'], ['dirty3.js'], ['exits.js'], ['est02.js'], ['perm01.js'], ['after.js'], ['dialogs.js']]) {
    run(['run.js', 'login']);
    run(phase);
    await wait(15000);
  }
})();
