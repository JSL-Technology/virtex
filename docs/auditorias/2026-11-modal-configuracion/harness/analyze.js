// Resume, regla por regla, lo que miden las fases del arnés (results/*.json) en la pasada final.
// Uso: node analyze.js > ../analysis.txt
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..', 'salida', 'results');
const load = (f) => JSON.parse(fs.readFileSync(path.join(R, f), 'utf8'));
const phases = ['base', 'dark', 'laptop', 'phone', 'density'];
const data = Object.fromEntries(phases.map((p) => [p, load(`${p}.json`)]));
const pages = Object.keys(data.base);
const out = [];
const say = (...a) => out.push(a.join(' '));

say(`Páginas medidas: ${pages.length}`);

// JER-01: cabecera común
const noHeader = pages.filter((id) => { const h = data.base[id].header || {}; return !(h.crumb && h.title && h.description && h.scope); });
say(`JER-01 cabecera completa (miga, título, descripción, alcance): ${pages.length - noHeader.length}/${pages.length}`, noHeader.length ? `faltan: ${noHeader}` : '');

// TIP-01 / JER-02: estilos de encabezado y jerarquía
const styles = {};
const inverted = [];
for (const id of pages) {
  const hs = data.base[id].headings || [];
  for (const h of hs) { const k = `${h.tag} ${h['font-size']}/${h['font-weight']}`; (styles[k] ||= new Set()).add(id); }
  const size = (t) => hs.filter((h) => h.tag === t).map((h) => parseFloat(h['font-size']));
  const h2 = size('h2'), h3 = size('h3');
  if (h2.length && h3.length && Math.max(...h3) > Math.min(...h2)) inverted.push(id);
}
say('TIP-01 estilos de encabezado de contenido:', Object.entries(styles).map(([k, v]) => `${k} (${v.size} págs.)`).join(' · '));
say(`JER-02 subnivel mayor que su nivel: ${inverted.length ? inverted : 'ninguno'}`);
const titleStyles = new Set(pages.map((id) => JSON.stringify(data.base[id].header?.titleStyle)));
say('JER-02 estilo del título (h1) de página:', [...titleStyles].join(' | '));

// TIP-02: mayúsculas sostenidas
const upper = pages.filter((id) => (data.base[id].upper || []).length);
say(`TIP-02 páginas con mayúsculas sostenidas: ${upper.length ? upper.map((id) => `${id}: ${JSON.stringify(data.base[id].upper)}`) : 'ninguna'}`);

// ACC-01: primarias reales (clase primary-button), habilitadas y visibles, por página
for (const p of ['base', 'phone']) {
  const over = [];
  for (const id of pages) {
    const prim = (data[p][id].buttons || []).filter((b) => /primary-button/.test(b.cls) && !b.disabled);
    if (prim.length > 1) over.push(`${id}: ${prim.map((b) => b.text)}`);
  }
  say(`ACC-01 [${p}] páginas con más de una primaria habilitada: ${over.length ? over : 'ninguna'}`);
}

// CON-01 / SOM-01 / RAD-01: contenedores
for (const p of ['base', 'phone']) {
  const all = [];
  for (const id of pages) for (const c of data[p][id].cards || []) all.push({ id, ...c });
  const shadow = all.filter((c) => c.shadow);
  const byCls = {};
  for (const c of all) { const fam = c.cls.split(' ')[0]; (byCls[fam] ||= new Set()).add(c.radius); }
  say(`SOM-01 [${p}] contenedores con sombra: ${shadow.length ? shadow.map((c) => `${c.id}:${c.cls}`) : 'ninguno'}`);
  say(`CON-01/RAD-01 [${p}] contenedores detectados por tipo (radio):`, Object.entries(byCls).map(([k, v]) => `${k} (${[...v]})`).join(' · ') || 'ninguno');
}

// FMT-01: formatos de moneda y fecha
const money = new Set(), dates = new Set();
for (const id of pages) { (data.base[id].money || []).forEach((m) => money.add(m)); (data.base[id].dates || []).forEach((d) => dates.add(d)); }
say('FMT-01 importes vistos:', [...money].join(' · ') || '—');
say('FMT-01 fechas vistas:', [...dates].join(' · ') || '—');

// EST-01: estados vacíos
const empties = [];
for (const id of pages) for (const e of data.base[id].empties || []) empties.push(`${id}:${e.cls}${e.icon ? '+icono' : ''}${e.action ? '+acción' : ''}`);
say('EST-01 estados vacíos:', empties.join(' · ') || '—');
const notCommon = empties.filter((e) => !/vx-empty-state/.test(e));
say(`EST-01 vacíos fuera del componente común: ${notCommon.length ? notCommon : 'ninguno'}`);

// CONT-01: claves crudas y traducciones que faltan
for (const p of phases) {
  const raw = pages.filter((id) => (data[p][id].rawKeys || []).length);
  const cons = pages.filter((id) => (data[p][id].console || []).some((c) => /translation|traducci|missing/i.test(JSON.stringify(c))));
  say(`CONT-01 [${p}] claves crudas: ${raw.length ? raw : 'ninguna'} · traducciones que faltan en consola: ${cons.length ? cons : 'ninguna'}`);
}

// A11Y-01/02/05: axe por condición
for (const p of phases) {
  const v = [];
  for (const id of pages) for (const x of data[p][id].axe || []) v.push(`${id}:${x.id || x.rule || JSON.stringify(x).slice(0, 40)}`);
  say(`A11Y axe [${p}] violaciones WCAG 2.2 AA: ${v.length ? v : '0'}`);
}

// RESP-01: desbordes y textos cortados en teléfono
const overflow = pages.filter((id) => data.phone[id].hOverflow);
const trunc = pages.filter((id) => (data.phone[id].truncated || []).length);
say(`RESP-01 [phone] desbordamiento horizontal: ${overflow.length ? overflow : 'ninguno'} · textos cortados: ${trunc.length ? trunc.map((id) => `${id}:${JSON.stringify(data.phone[id].truncated)}`) : 'ninguno'}`);

// HTTP y consola
for (const p of phases) {
  const http = pages.filter((id) => (data[p][id].http || []).length);
  const cons = pages.filter((id) => (data[p][id].console || []).length);
  say(`Red/consola [${p}] errores HTTP: ${http.length ? http.map((id) => `${id}:${JSON.stringify(data[p][id].http)}`) : 'ninguno'} · mensajes de consola: ${cons.length ? cons.map((id) => `${id}:${JSON.stringify(data[p][id].console).slice(0, 160)}`) : 'ninguno'}`);
}

// Campos nativos sin estilo común
const native = pages.filter((id) => (data.base[id].native || []).length);
say(`FORM/COMP controles nativos sin estilo: ${native.length ? native.map((id) => `${id}:${JSON.stringify(data.base[id].native)}`) : 'ninguno'}`);

// A11Y-03/04: teclado
const focus = load('focus.json');
const fl = Object.entries(focus).map(([k, v]) => ({ ...v, key: v.key || k }));
say(`A11Y-04 fugas de foco: ${fl.reduce((a, f) => a + (f.leftPanel || 0), 0)} en ${fl.length} páginas`);
say(`A11Y-03 paradas sin anillo propio: ${fl.filter((f) => f.noRing.length).map((f) => `${f.key}: ${f.noRing.length} (${[...new Set(f.noRing.map((n) => n.split(' ')[0].replace(/#[^.]*/, '#…')))]})`).join(' · ') || 'ninguna'}`);
say(`A11Y-03 paradas sobre una caja invisible: ${fl.filter((f) => f.invisibleBox.length).map((f) => `${f.key}: ${f.invisibleBox}`).join(' · ') || 'ninguna'}`);
say(`A11Y-03 paradas tapadas: ${fl.filter((f) => f.covered.length).map((f) => f.key).join(' · ') || 'ninguna'}`);

// NAV-01
const search = load('search.json');
say('NAV-01 buscador:', Object.entries(search).map(([q, r]) => `«${q}» → ${JSON.stringify(r)}`).join(' · '));

// GUA-01, EST-02, PERM-01
const verdicts = (f) => { const j = load(f); const rows = Array.isArray(j) ? j : Object.entries(j.sections || j.results || j).map(([k, v]) => ({ id: k, ...(typeof v === 'object' ? v : {}) })); return rows.filter((r) => r.verdict).map((r) => [r.id || r.key, r.verdict]); };
for (const f of ['dirty3.json', 'est02.json', 'perm01.json']) {
  const v = verdicts(f);
  const count = (re) => v.filter(([, x]) => re.test(x)).length;
  say(`${f}: CUMPLE ${count(/^CUMPLE/)} · N/A ${count(/^N\/A/)} · NO CUMPLE ${count(/NO CUMPLE/)}`, v.filter(([, x]) => /NO CUMPLE/.test(x)).map(([k, x]) => `${k}: ${x}`).join(' · '));
}
console.log(out.join('\n'));
