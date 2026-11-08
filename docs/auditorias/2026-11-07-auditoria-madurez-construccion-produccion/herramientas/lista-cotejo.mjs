// Lista de cotejo de todos los hallazgos: ✅ resuelto, ❌ parcial o pendiente (— no aplica).
// Lee /tmp/claude-0/v/findings.json (extraer-hallazgos.mjs) y los estados de 10-verificacion-de-cierre.md.
//   node docs/auditorias/2026-11-07-auditoria-madurez-construccion-produccion/herramientas/lista-cotejo.mjs <salida.md>
import fs from 'node:fs';
import path from 'node:path';
const DIR = 'docs/auditorias/2026-11-07-auditoria-madurez-construccion-produccion';
const findings = JSON.parse(fs.readFileSync('/tmp/claude-0/v/findings.json', 'utf8'));
const report = fs.readFileSync(`${DIR}/10-verificacion-de-cierre.md`, 'utf8').split('\n');

// Estado y severidad normalizada por ID, tal como los publica el informe de cierre.
const state = {};
let section = null;
for (const line of report) {
  const h = /^## ([A-ZÁÉÍÓÚ ]+) \(\d+\)/.exec(line);
  if (h) { section = h[1].trim(); continue; }
  const row = /^\| ([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+) \| ([^|]+) \|/.exec(line);
  if (row && section) state[row[1]] = { st: section, sev: row[2].trim(), falta: section === 'PARCIAL' ? line.split('|').slice(-2, -1)[0].trim() : '' };
}

const clean = (s) => s.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const META = /^(eje|ejes)\b|^severidad|^(cr[ií]tica|alta|media|baja|alto|bajo)\b|^categor[ií]a|^[a-z-]+( \/ [a-z-]+)?$/i;
// Los patrones sistémicos se describen por su título en 07-patrones-sistemicos.md.
const patterns = Object.fromEntries(
  fs.readFileSync(`${DIR}/07-patrones-sistemicos.md`, 'utf8').split('\n')
    .map((l) => /^## (SP-\d+) · (.+)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
);
function describe(f) {
  if (patterns[f.id]) return patterns[f.id];
  const lines = fs.readFileSync(path.join(DIR, f.file), 'utf8').split('\n');
  const def = lines[f.line - 1] ?? '';
  // Fila de tabla: la celda que nombra el hallazgo y lo que la tabla dice de él.
  if (def.trim().startsWith('|')) {
    const cells = def.split('|').map((c) => clean(c)).filter(Boolean);
    const i = cells.findIndex((c) => c.includes(f.id));
    if (i >= 0) {
      const name = cells[i].replace(/\s*\([^)]*\)\s*/g, ' ').trim();
      return [name, ...cells.slice(i + 1, i + 3)].filter((c) => c && !/^(alto|media|bajo|baja|alta|cr[ií]tica)$/i.test(c)).join(' — ');
    }
  }
  const idx = def.indexOf(f.id);
  const rest = clean(idx >= 0 ? def.slice(idx + f.id.length) : def).replace(/^[\s*—:·\-)(=]+/, '');
  // Una descripción en las líneas siguientes («Qué está mal», «Qué:») manda.
  for (let i = f.line; i < Math.min(lines.length, f.line + 6); i++) {
    const l = clean(lines[i] ?? '');
    if (/^[-*]?\s*(Qué está mal|Qué)\s*:/i.test(l)) {
      const body = l.replace(/^[-*]?\s*(Qué está mal|Qué)\s*:\s*/i, '');
      return body || clean(lines[i + 1] ?? '').replace(/^[-*]\s*/, '');
    }
    if (/\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b/.test(lines[i] ?? '') && /\*\*/.test(lines[i] ?? '')) break;
  }
  const inline = /(Qué está mal|Qué)\s*:\s*(.+)/i.exec(rest);
  if (inline) return inline[2];
  const parts = rest.split(/ · | — /).map((p) => p.trim()).filter((p) => p && !META.test(p));
  const prose = parts.filter((p) => p.split(' ').length >= 5);
  const pick = (prose.sort((a, b) => b.length - a.length)[0] ?? parts.join(' · ')) || rest;
  if (pick.split(' ').length < 5) {
    const next = lines.slice(f.line, f.line + 3)
      .filter((l) => !(/\*\*[A-Z]{2,}(?:-[A-Z0-9]+)+\*\*/.test(l)))
      .map(clean).find((l) => l && !/^[-*]?\s*Ubicación/i.test(l));
    if (next) return `${pick ? pick + ': ' : ''}${next.replace(/^[-*]\s*/, '')}`;
  }
  return pick;
}
// Si la línea citada no es la que define el hallazgo (una tabla, una mención), se busca su ficha.
const allMd = [...fs.readdirSync(DIR).filter((f) => f.endsWith('.md')), ...fs.readdirSync(`${DIR}/modulos`).map((f) => `modulos/${f}`)];
function definitionOf(id) {
  for (const file of allMd) {
    const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split('\n');
    const i = lines.findIndex((l) => new RegExp(`^\\s*(?:[-*]\\s*)?\\*\\*(?:⚠️ )?${id}\\b`).test(l));
    if (i >= 0) return { file, line: i + 1 };
  }
  return null;
}
const looksWrong = (d) => !d || d.length < 12 || /^[|.,)\\]|##|^\(/.test(d) || /\| (Parcial|Resuelto|Ausentes)/.test(d);
function describeBest(f) {
  const d = describe(f);
  if (!looksWrong(d)) return { desc: d, file: f.file, line: f.line };
  const def = definitionOf(f.id);
  if (def) { const d2 = describe({ ...f, ...def }); if (!looksWrong(d2)) return { desc: d2, ...def }; }
  return { desc: d || '(ver ficha)', file: f.file, line: f.line };
}
/** Una descripción muy corta se precede del módulo de su ficha, para que se entienda sola. */
function withModule(r) {
  if (r.desc.split(' ').length >= 6 || !r.file.startsWith('modulos/')) return r;
  return { ...r, desc: `${path.basename(r.file, '.md')}: ${r.desc}` };
}
const cut = (s, n = 190) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const esc = (s) => s.replace(/\|/g, '\\|');

const SEV_ORDER = ['Crítica', 'Alta', 'Media', 'Baja', '—'];
const rows = findings
  .map((f) => ({ ...f, ...(state[f.id] ?? { st: 'PENDIENTE', sev: '—' }) }))
  .map((f) => ({ ...f, mark: f.st === 'RESUELTO' ? '✅' : f.st === 'INFORMATIVO' || f.st === 'NO ES HALLAZGO' ? '—' : '❌', ...describeBest(f) })).map(withModule);

const real = rows.filter((r) => r.mark !== '—');
const ok = real.filter((r) => r.mark === '✅').length;
let md = `# Lista de cotejo de hallazgos (${new Date().toISOString().slice(0, 10)})\n\n`;
md += `Todos los hallazgos de los MD de la auditoría, con su estado en [\`10-verificacion-de-cierre.md\`](10-verificacion-de-cierre.md). `;
md += `✅ = resuelto y verificado · ❌ = parcial o pendiente (en los parciales se indica lo que falta).\n\n`;
md += `**${ok} de ${real.length} resueltos; ${real.length - ok} por corregir** (${real.filter((r) => r.st === 'PARCIAL').length} parciales). `;
md += `Aparte, ${rows.length - real.length} identificadores no son hallazgos (informativos o referencias) y se listan al final.\n\n`;
md += `Generado con \`herramientas/lista-cotejo.mjs\`; la descripción es un extracto de la ficha citada.\n\n`;
md += `| Severidad | ✅ | ❌ |\n|---|---|---|\n`;
for (const s of SEV_ORDER) {
  const g = real.filter((r) => r.sev === s);
  if (g.length) md += `| ${s} | ${g.filter((r) => r.mark === '✅').length} | ${g.filter((r) => r.mark === '❌').length} |\n`;
}
for (const s of SEV_ORDER) {
  const g = real.filter((r) => r.sev === s).sort((a, b) => (a.mark === b.mark ? a.id.localeCompare(b.id, 'es', { numeric: true }) : a.mark === '❌' ? -1 : 1));
  if (!g.length) continue;
  md += `\n## Severidad ${s === '—' ? 'no indicada (patrones y transversales)' : s.toLowerCase()} (${g.length})\n\n| | ID | Hallazgo | Ficha |\n|---|---|---|---|\n`;
  for (const r of g) {
    const extra = r.st === 'PARCIAL' ? ` **Parcial — falta:** ${r.falta}` : '';
    md += `| ${r.mark} | ${r.id} | ${esc(cut(r.desc))}${esc(extra)} | \`${r.file}:${r.line}\` |\n`;
  }
}
const na = rows.filter((r) => r.mark === '—');
md += `\n## No son hallazgos (${na.length})\n\nIdentificadores informativos o de referencia (flujos, insumos): no llevan corrección.\n\n| ID | Tipo | Ficha |\n|---|---|---|\n`;
for (const r of na) md += `| ${r.id} | ${r.st.toLowerCase()} | \`${r.file}:${r.line}\` |\n`;
fs.writeFileSync(process.argv[2], md);
console.log(`${real.length} hallazgos: ${ok} ✅, ${real.length - ok} ❌; ${na.length} no aplican`);
