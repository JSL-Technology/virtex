#!/usr/bin/env node
/**
 * Splits a message whose verb is chosen by a ternary into two whole sentences.
 *
 *     showSuccess(`Cliente ${this.isEditMode() ? 'actualizado' : 'creado'} exitosamente.`)
 *
 * is untranslatable as one string. The two branches inflect a Spanish participle to agree with a
 * Spanish noun; English needs "Customer updated"/"Customer created" with the word in a different
 * position, and Portuguese agrees differently again. Eighteen call sites did this, all with the
 * same shape.
 *
 *     showSuccess(this.isEditMode() ? 'X.UPDATED' : 'X.CREATED')
 *
 * Two complete sentences, each translatable on its own, and the condition stays exactly where it
 * was. This is the one case the general extraction refuses to touch, precisely because a
 * mechanical rewrite of it would have produced the sentence-fragment antipattern.
 *
 *   node tools/i18n/split-ternary-messages.mjs --dry
 *   node tools/i18n/split-ternary-messages.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = 'apps/core/client-web/src/app';
const CATALOGUE = 'apps/core/client-web/src/assets/i18n/es.json';
const DRY = process.argv.includes('--dry');

/**
 * `Cliente ${cond ? 'actualizado' : 'creado'} exitosamente.` — a template literal with exactly
 * one hole, and that hole a ternary between two string literals. Anything else is left alone:
 * two holes, or a hole that is not a ternary, is not this transformation.
 */
const TERNARY_MESSAGE =
  /\.(showSuccess|showError|showInfo|showWarning)\(\s*`([^`$]*)\$\{\s*([^?{}]+?)\s*\?\s*'([^']*)'\s*:\s*'([^']*)'\s*\}([^`$]*)`\s*,?\s*\)/g;

const STOP_WORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'al', 'en', 'y', 'o', 'que', 'se', 'su',
  'con', 'por', 'para', 'lo',
]);

function slugFor(text) {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9\s]/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
      .slice(0, 6)
      .join('_')
      .toUpperCase() || 'MESSAGE'
  );
}

function namespaceFor(file) {
  const parts = relative(ROOT, file).split(sep);
  const folder = parts.at(-2) ?? parts.at(-1);
  const area = parts[0] === 'features' || parts[0] === 'layout' ? parts[1] : parts[0];
  const name = (folder ?? 'common').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  const areaName = (area ?? 'common').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  return areaName === name ? name : `${areaName}.${name}`;
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

const catalogue = {};
let rewritten = 0;

function setKey(tree, key, value) {
  const parts = key.split('.');
  let node = tree;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

function getKey(tree, key) {
  return key
    .split('.')
    .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), tree);
}

function keyFor(namespace, text) {
  const base = `${namespace}.${slugFor(text)}`;
  for (let ordinal = 1; ; ordinal++) {
    const candidate = ordinal === 1 ? base : `${base}_${ordinal}`;
    const found = getKey(catalogue, candidate);
    if (found === undefined || found === text) {
      setKey(catalogue, candidate, text);
      return candidate;
    }
  }
}

for (const file of sourceFiles(ROOT)) {
  const original = readFileSync(file, 'utf8');
  const namespace = namespaceFor(file);

  const source = original.replace(
    TERNARY_MESSAGE,
    (whole, method, before, condition, whenTrue, whenFalse, after) => {
      const truthy = `${before}${whenTrue}${after}`.trim();
      const falsy = `${before}${whenFalse}${after}`.trim();
      if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(truthy)) return whole;

      rewritten++;
      return `.${method}(${condition} ? '${keyFor(namespace, truthy)}' : '${keyFor(namespace, falsy)}')`;
    },
  );

  if (source !== original && !DRY) writeFileSync(file, source);
}

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? deepMerge(typeof out[key] === 'object' && out[key] !== null ? out[key] : {}, value)
        : value;
  }
  return out;
}

if (!DRY) {
  const existing = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
  writeFileSync(CATALOGUE, JSON.stringify(deepMerge(existing, catalogue), null, 2) + '\n');
}

console.log(`ternary messages split  ${rewritten}`);
