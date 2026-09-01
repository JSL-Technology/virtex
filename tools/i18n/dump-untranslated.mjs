#!/usr/bin/env node
/** Dump distinct Spanish strings that still need a translation, as JSONL for a batch. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIRS = ['apps/core/client-web/src/assets/i18n', 'apps/backend/api/src/app/i18n/messages'];
const glossary = JSON.parse(readFileSync('tools/i18n/glossary.json', 'utf8'));
const limit = Number(process.argv.find((a) => /^--limit=\d+$/.test(a))?.split('=')[1] ?? 80);
const offset = Number(process.argv.find((a) => /^--offset=\d+$/.test(a))?.split('=')[1] ?? 0);
const language = process.argv.includes('--pt') ? 'pt' : 'en';

function flatten(tree, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flatten(value, path, out);
    else out.set(path, String(value));
  }
  return out;
}

const seen = new Map();
for (const dir of DIRS) {
  for (const [key, value] of flatten(JSON.parse(readFileSync(join(dir, 'es.json'), 'utf8')))) {
    if (!seen.has(value)) seen.set(value, key);
  }
}

const pending = [...seen.entries()].filter(([value]) => glossary.terms[value]?.[language] === undefined);
console.log(`# ${language}: ${pending.length} pending, showing ${offset}..${offset + limit}`);
for (const [value, key] of pending.slice(offset, offset + limit)) {
  // Which languages this string still needs, so a batch does not re-send a translation that is
  // already reviewed and would be kept anyway.
  const need = ['en', 'pt'].filter((l) => glossary.terms[value]?.[l] === undefined).join('+');
  console.log(`${JSON.stringify(value)}   |${need}| ${key}`);
}
