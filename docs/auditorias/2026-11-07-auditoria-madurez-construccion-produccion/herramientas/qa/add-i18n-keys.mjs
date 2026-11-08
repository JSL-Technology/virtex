// usage (desde la raíz del repo): node docs/auditorias/2026-11-07-auditoria-madurez-construccion-produccion/herramientas/qa/add-i18n-keys.mjs file.json  — file: { "<base file>": { "<key>": [es, en, pt] } }
import fs from 'node:fs';
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const base = 'libs/shared/locales/src/base/';
for (const [file, entries] of Object.entries(spec)) {
  const p = base + file + '.json';
  const o = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  for (const [k, [es, en, pt]] of Object.entries(entries)) o[k] = { es, en, pt };
  fs.writeFileSync(p, JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])), null, 2) + '\n');
}
