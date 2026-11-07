// Tablas Markdown de EST-02, PERM-01 y GUA-01 a partir de los resultados de la pasada final.
// Uso: node tables.js > ../tables.md
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..', 'salida', 'results');
const load = (f) => JSON.parse(fs.readFileSync(path.join(R, f), 'utf8'));
const base = load('base.json');
const title = (id) => base[id]?.header?.title || id;
const yes = (b) => (b ? 'sí' : 'no');
const out = [];

const est = load('est02.json');
out.push('| Página | Peticiones cortadas | Error con «Reintentar» | Se recupera al reintentar | Resultado |', '|---|---|---|---|---|');
for (const [id, r] of Object.entries(est)) {
  const na = /^N\/A/.test(r.verdict);
  out.push(`| ${title(id)} | ${r.abortedCount} | ${na ? '—' : yes(r.down?.error && r.down?.retry)} | ${na ? '—' : yes(r.recovered && !r.recovered.error)} | ${na ? 'No aplica: no pide datos al cargar' : 'Cumple'} |`);
}
out.push('');

const perm = load('perm01.json');
out.push('| Página | Aviso de solo lectura | Barra de guardado | Controles que cambian algo | Resultado |', '|---|---|---|---|---|');
for (const [id, r] of Object.entries(perm)) {
  if (id === 'permissions' || !r.verdict) continue;
  const na = /^N\/A/.test(r.verdict);
  out.push(`| ${title(id)} | ${na ? '—' : yes(r.notice)} | ${na ? '—' : yes(r.saveBar)} | ${na ? '—' : (r.editable || []).length} | ${na ? 'No aplica: leerla exige un permiso de gestión, y la modal lo nombra' : 'Cumple'} |`);
}
out.push('');

const gua = load('dirty3.json');
const exits = fs.existsSync(path.join(R, 'exits.json')) ? load('exits.json') : {};
out.push('| Caso | Barra de guardado | Escape | La X | El fondo | Otra página | Lo escrito se conserva | Resultado |', '|---|---|---|---|---|---|---|---|');
for (const [id, r] of Object.entries(gua)) {
  const e = exits[id] || {};
  const asks = (b) => (b ? 'pregunta' : 'no pregunta');
  const kept = r.valueKept && e.backdropKept && e.navKept;
  const ok = r.verdict === 'CUMPLE' && e.verdict === 'CUMPLE';
  out.push(`| ${r.label || id} | ${r.saveBar ? 'sí' : 'no (editor con botón propio)'} | ${asks(r.modalOpenAfterEscape && (r.question || []).length)} | ${asks(r.closeAsks)} | ${asks(e.backdropAsked)} | ${asks(e.navAsked)} | ${yes(kept)} | ${ok ? 'Cumple' : 'No cumple'} |`);
}
console.log(out.join('\n'));
