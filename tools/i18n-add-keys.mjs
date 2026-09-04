#!/usr/bin/env node
/**
 * Add message keys to every server catalogue at once.
 *
 * `messages.parity.spec.ts` fails the build when a key exists in one language and not another, and
 * hand-editing three JSON files in lockstep is exactly the chore that produces that failure. This
 * takes a JSON map of `{ "SECTION.KEY": { es, en, pt } }` on stdin and writes each translation into
 * its catalogue, creating intermediate sections and leaving existing keys untouched.
 *
 *   node tools/i18n-add-keys.mjs < keys.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MESSAGES = join(here, '..', 'apps', 'backend', 'api', 'src', 'app', 'i18n', 'messages');
const LANGUAGES = ['es', 'en', 'pt'];

const input = JSON.parse(readFileSync(0, 'utf8'));

/** Sort an object's keys, recursively, so the catalogues stay diffable. */
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
    if (value === undefined) {
      throw new Error(`Key ${dotted} has no ${language} translation`);
    }

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

console.log(`i18n: ${added / LANGUAGES.length} claves añadidas, ${skipped / LANGUAGES.length} ya existían.`);
