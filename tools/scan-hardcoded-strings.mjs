#!/usr/bin/env node
/**
 * Cuenta el texto de interfaz que NO pasa por el catálogo de traducción.
 *
 * Un literal en una plantilla no es un error de tipos, ni de compilación, ni de render: es una
 * cadena que simplemente sale en pantalla en el idioma en que se escribió. Este escáner es lo que
 * convierte esa clase de defecto en un número que se puede seguir en el tiempo.
 *
 * Uso:
 *   node tools/scan-hardcoded-strings.mjs            # resumen
 *   node tools/scan-hardcoded-strings.mjs --list     # además, cada hallazgo con fichero:línea
 *
 * Algoritmo (deliberadamente conservador, para no inflar la cifra):
 *   1. Se eliminan los comentarios HTML.
 *   2. Se eliminan las cabeceras de los bloques de control de Angular (`@if (...) {`, `@for`, ...),
 *      cuyas expresiones no son texto de interfaz.
 *   3. Se capturan los nodos de texto `>...<` que no contengan `{`, `}` ni `@`, de modo que
 *      cualquier interpolación —incluido `{{ 'X' | translate }}`— queda fuera por construcción.
 *   4. Se descarta lo que no tenga tres letras seguidas (números, símbolos, iconos).
 *   5. Aparte, se capturan los atributos legibles por una persona con valor literal.
 *
 * Un muestreo determinista de 31 resultados sobre este repositorio no arrojó falsos positivos.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'apps/core/client-web/src';
const HUMAN_ATTRS = /\s(placeholder|title|alt|aria-label|aria-description|label)\s*=\s*"([^"{}]+)"/g;
const CONTROL_FLOW = /@(if|for|switch|case|else if|else|defer|placeholder|loading|empty)\b[^{]*\{/g;
const TEXT_NODE = />([^<>{}@]*)</g;
const HAS_LETTERS = /[A-Za-zÁÉÍÓÚÑÜáéíóúñü]{3}/;
const ENTITY = /&[a-z]+;|&#x?[0-9a-f]+;/gi;

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return htmlFiles(full);
    return full.endsWith('.html') ? [full] : [];
  });
}

const list = process.argv.includes('--list');
const files = htmlFiles(ROOT);
let textNodes = 0;
let attributes = 0;
const offenders = new Map();

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const src = raw.replace(/<!--[\s\S]*?-->/g, '').replace(CONTROL_FLOW, '{');
  const hits = [];

  for (const match of src.matchAll(TEXT_NODE)) {
    const text = match[1].replace(ENTITY, '').trim();
    if (!text || !HAS_LETTERS.test(text)) continue;
    hits.push({ line: src.slice(0, match.index).split('\n').length, text });
    textNodes++;
  }

  for (const match of src.matchAll(HUMAN_ATTRS)) {
    const value = match[2].trim();
    if (!HAS_LETTERS.test(value)) continue;
    hits.push({ line: src.slice(0, match.index).split('\n').length, text: `${match[1]}="${value}"` });
    attributes++;
  }

  if (hits.length) offenders.set(file, hits);
}

const usingTranslate = files.filter((f) => readFileSync(f, 'utf8').includes('translate')).length;

console.log(`plantillas HTML                 ${files.length}`);
console.log(`  usan translate                ${usingTranslate}`);
console.log(`  no usan translate             ${files.length - usingTranslate}`);
console.log(`nodos de texto literal          ${textNodes}`);
console.log(`atributos humanos literales     ${attributes}`);
console.log(`plantillas con texto literal    ${offenders.size}`);

if (list) {
  for (const [file, hits] of [...offenders].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${file}  (${hits.length})`);
    for (const hit of hits) console.log(`  ${hit.line}: ${hit.text.slice(0, 100)}`);
  }
}
