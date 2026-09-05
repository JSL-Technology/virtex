#!/usr/bin/env node
/**
 * Add message keys to every client catalogue at once.
 *
 * The counterpart of `i18n-add-keys.mjs` for the Angular app, which has its own catalogues under
 * `assets/i18n` and its own parity spec. Same contract: a JSON map of
 * `{ "SECTION.KEY": { es, en, pt } }` on stdin, existing keys left untouched.
 *
 *   node tools/i18n-add-client-keys.mjs < keys.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MESSAGES = join(here, '..', 'apps', 'core', 'client-web', 'src', 'assets', 'i18n');
const LANGUAGES = ['es', 'en', 'pt'];

const input = JSON.parse(readFileSync(0, 'utf8'));

function sortTree(node) {
  if (typeof node !== 'object' || node === null) return node;
  return Object.fromEntries(
    Object.keys(node)
      .sort()
      .map((key) => [key, sortTree(node[key])]),
  );
}

let added = 0;
let skipped = 0;

for (const language of LANGUAGES) {
  const file = join(MESSAGES, `${language}.json`);
  const catalogue = JSON.parse(readFileSync(file, 'utf8'));

  for (const [dotted, translations] of Object.entries(input)) {
    const value = translations[language];
    if (value === undefined) throw new Error(`Key ${dotted} has no ${language} translation`);

    const path = dotted.split('.');
    const leaf = path.pop();
    let node = catalogue;
    for (const segment of path) {
      if (typeof node[segment] !== 'object' || node[segment] === null) node[segment] = {};
      node = node[segment];
    }
    if (node[leaf] !== undefined) {
      skipped += 1;
      continue;
    }
    node[leaf] = value;
    added += 1;
  }

  writeFileSync(file, `${JSON.stringify(sortTree(catalogue), null, 2)}\n`);
}

console.log(
  `i18n cliente: ${added / LANGUAGES.length} claves añadidas, ${skipped / LANGUAGES.length} ya existían.`,
);
