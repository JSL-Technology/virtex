// Prints `export K='V'` lines with the CI job's environment (from .github/workflows/ci.yml), so the
// boot-based verifiers (verify:boot, verify:markets, verify:invoicing…) run locally exactly as in CI:
//   node docs/auditorias/2026-11-07-auditoria-madurez-construccion-produccion/herramientas/qa/ci-env.mjs > /tmp/ci-env.sh && source /tmp/ci-env.sh
// Values that CI takes from GitHub secrets (`${{ … }}`) are skipped.
import fs from 'node:fs';
const text = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
const lines = text.split('\n');
let inEnv = false; let indent = -1;
for (const line of lines) {
  const m = /^(\s*)env:\s*$/.exec(line);
  if (m) { inEnv = true; indent = m[1].length; continue; }
  if (inEnv) {
    const lead = /^(\s*)/.exec(line)[1].length;
    if (line.trim() && lead <= indent) { inEnv = false; continue; }
    const kv = /^\s*([A-Z0-9_]+):\s*(.*)$/.exec(line);
    if (kv && !kv[2].includes('${{')) console.log(`export ${kv[1]}='${kv[2].replace(/^['"]|['"]$/g, '')}'`);
  }
}
