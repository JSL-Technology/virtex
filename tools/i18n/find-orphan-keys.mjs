#!/usr/bin/env node
/**
 * Catalogue entries no source file references.
 *
 *   node tools/i18n/find-orphan-keys.mjs           # list them
 *   node tools/i18n/find-orphan-keys.mjs --prune   # delete them from es.json
 *
 * A key nothing uses is dead code with a translation bill attached: it costs a line in three
 * catalogues, it is sent for translation into two languages, and it makes the real gap look
 * bigger than it is. They accumulate on their own — a template is rewritten, its keys are not.
 *
 * ## Why the runtime-composed prefixes are protected
 *
 * `INVOICES.STATUS.PARTIALLY_PAID` is never written as a literal anywhere: the component builds
 * it from a stored value. Pruning by "no literal occurrence" would delete exactly the keys whose
 * absence is hardest to notice, so any key under a prefix that IS referenced as a literal is kept.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP_ROOT = 'apps/core/client-web/src/app';
const CATALOGUE = 'apps/core/client-web/src/assets/i18n/es.json';
const PRUNE = process.argv.includes('--prune');

/**
 * A quoted string that looks like a catalogue key.
 *
 * Single-segment keys are matched too — `APP_TITLE` is one, and reporting it as dead would have
 * deleted the product name out of every page title. The coverage spec deliberately requires two
 * segments (a lone word is a value far more often than a key); here the trade-off runs the other
 * way, because a false positive DELETES something.
 */
const KEY_PATTERN = /['"`]((?:[A-Z][A-Z0-9_]*|[a-z][a-z0-9_]*)(?:\.[A-Za-z0-9_]+)*)['"`]/g;

/**
 * The groups whose leaf is composed at runtime, read from the one place that declares them.
 *
 * Parsed out of the TypeScript rather than imported because this is a plain Node script with no
 * build step; the shape it reads — `['PREFIX', ['VALUE', …]]` — is stable and the file exists to
 * be read by both sides. A prefix that stops being listed there stops being protected here, which
 * is the intended coupling.
 */
function runtimeComposedPrefixes() {
  const source = readFileSync(
    'apps/core/client-web/src/app/core/i18n/runtime-composed-keys.ts',
    'utf8',
  );
  return new Set([...source.matchAll(/\[\s*'([A-Z][A-Z0-9_.]*)'\s*,/g)].map((m) => m[1]));
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') || full.endsWith('.html') ? [full] : [];
  });
}

function flatten(tree, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flatten(value, path, out);
    else out.set(path, value);
  }
  return out;
}

const used = new Set();
for (const file of sourceFiles(APP_ROOT)) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(KEY_PATTERN)) used.add(match[1]);
}

/** Every prefix a used key sits under, so a composed sibling is not mistaken for dead. */
const usedPrefixes = new Set();
for (const key of used) {
  const parts = key.split('.');
  for (let i = 1; i < parts.length; i++) usedPrefixes.add(parts.slice(0, i).join('.'));
}

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const flat = flatten(catalogue);

const protectedPrefixes = runtimeComposedPrefixes();

const orphans = [...flat.keys()].filter((key) => {
  if (used.has(key)) return false;
  for (const prefix of protectedPrefixes) if (key.startsWith(`${prefix}.`)) return false;
  // Kept when a sibling under the same immediate parent IS used: that parent is a group the code
  // addresses by composing the last segment at runtime.
  const parent = key.slice(0, key.lastIndexOf('.'));
  return !usedPrefixes.has(key) && !siblingUsed(parent);
});

function siblingUsed(parent) {
  for (const key of used) if (key.startsWith(`${parent}.`)) return true;
  return false;
}

console.log(`${orphans.length} catalogue keys are referenced by no source file`);
for (const key of orphans) console.log(`  ${key}\t${JSON.stringify(flat.get(key))}`);

if (PRUNE) {
  for (const key of orphans) {
    const parts = key.split('.');
    let node = catalogue;
    for (const part of parts.slice(0, -1)) node = node?.[part];
    if (node) delete node[parts.at(-1)];
  }
  // Drop sections left empty by the prune, so the file does not accumulate hollow objects.
  const prune = (node) => {
    for (const [key, value] of Object.entries(node)) {
      if (value !== null && typeof value === 'object') {
        prune(value);
        if (Object.keys(value).length === 0) delete node[key];
      }
    }
  };
  prune(catalogue);
  writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`);
  console.log(`pruned ${orphans.length} keys`);
}
