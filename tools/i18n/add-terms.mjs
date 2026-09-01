#!/usr/bin/env node
/**
 * Merge a batch of translations into the glossary.
 *
 *   node tools/i18n/add-terms.mjs batch.json
 *
 * `batch.json` is `{ "<spanish>": { "en": "…", "pt": "…" }, … }`. Merging rather than replacing,
 * so a batch may fill in only the language it has.
 *
 * An existing translation is NOT overwritten without `--force`. The English catalogue was
 * reviewed before any of this work started, and a bulk re-translation quietly rewording 847
 * strings somebody signed off on is not an improvement — it is a diff nobody can read.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const GLOSSARY = 'tools/i18n/glossary.json';
const batch = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const glossary = JSON.parse(readFileSync(GLOSSARY, 'utf8'));

const force = process.argv.includes('--force');
let added = 0;
let kept = 0;
for (const [spanish, translations] of Object.entries(batch)) {
  glossary.terms[spanish] ??= {};
  for (const [language, value] of Object.entries(translations)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    if (!force && glossary.terms[spanish][language] !== undefined) {
      kept++;
      continue;
    }
    glossary.terms[spanish][language] = value;
    added++;
  }
}

writeFileSync(GLOSSARY, `${JSON.stringify(glossary, null, 2)}\n`);
console.log(
  `merged ${added} translations (${kept} existing kept); ` +
    `glossary now holds ${Object.keys(glossary.terms).length} terms`,
);
