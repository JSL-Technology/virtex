/**
 * One-time: fold the two old catalogues into the single source under `libs/shared/locales`.
 *
 * ## What changes
 *
 * Before, there were three places a translation could come from: the client catalogue, the server
 * catalogue, and `glossary.json` — which held 3.068 terms keyed by the SPANISH STRING, so
 * `en.json` and `pt.json` were rebuilt from `es.json` by looking each sentence up. Two keys that
 * happened to share a Spanish value therefore shared an English one, whether or not they meant the
 * same thing; 1.518 client keys and 162 server keys were in that position, and the five
 * `overrides` entries in the glossary were the hand-patches for the collisions that had been
 * noticed.
 *
 * After, a key is defined exactly once, with all of its languages together:
 *
 *     "accounting.fiscal_year.closed": {
 *       "es": "El año fiscal está cerrado.",
 *       "en": "The fiscal year is closed.",
 *       "pt": "O exercício fiscal está encerrado."
 *     }
 *
 * Nothing is derived from anything. Rewording the Spanish cannot reach another key, and a
 * translator sees the three languages side by side instead of a lookup table.
 *
 * A key whose value is the same in every language — a keyboard shortcut, a placeholder e-mail
 * address, the legal name a tax authority gives a document — is stored as `{ "literal": … }`, so
 * "identical in three languages" reads as a decision rather than as two missing translations.
 *
 * ## Output shape
 *
 * One file per top-level namespace under `base/`, keys flat and dotted inside it. Flat because the
 * nesting in the old catalogues made a key impossible to grep for: `"CANCELAR"` appeared under
 * forty parents and finding the one you wanted meant reading the tree.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT = `${ROOT}/libs/shared/locales/src/base`;

const LANGUAGES = ['es', 'en', 'pt'];
/**
 * The two catalogues this script folded together.
 *
 * They lived at `apps/core/client-web/src/assets/i18n` and
 * `apps/backend/api/src/app/i18n/messages`. Those paths now hold GENERATED output, so the inputs
 * are named here under a directory that is deliberately absent: re-running this script has to fail
 * loudly rather than quietly re-read its own output and produce a source of truth from it.
 *
 * To re-run it, check the two directories out of the commit before `libs/shared/locales` existed:
 *
 *     git show <commit>:apps/core/client-web/src/assets/i18n  # etc.
 */
const OLD = [
  `${HERE}/legacy-catalogues/client-web`,
  `${HERE}/legacy-catalogues/api`,
];

/**
 * This script ran once, on 2026-09-14, and its inputs no longer exist: the two legacy catalogues
 * it folded together were deleted in the same change that added `libs/shared/locales`. It is kept
 * because it is the record of HOW the current source was derived — which conflicts were resolved
 * which way, which values were in the wrong language — and because that record is only checkable
 * if the code that produced it is still here.
 *
 * From here on, a new key is added to `libs/shared/locales/src/base/<namespace>.json` by hand and
 * `tools/i18n/build-catalogues.mjs` emits it.
 */
const LEGACY_NOTICE = [
  'build-locale-source.mjs is a spent migration: the legacy catalogues it reads were removed once',
  'libs/shared/locales became the source. Add new keys to libs/shared/locales/src/base/ instead,',
  'then run: node tools/i18n/build-catalogues.mjs',
].join('\n');

const read = (p) => {
  if (!fs.existsSync(p)) {
    console.error(LEGACY_NOTICE);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === 'object' && !Array.isArray(v) ? flat(v, p ? `${p}.${k}` : k) : [[p ? `${p}.${k}` : k, v]]);

const renameMap = read(`${HERE}/rename-map.json`);
const redirects = read(`${HERE}/key-redirects.json`);
const resolutions = read(`${HERE}/conflict-resolutions.json`);
const valueFixes = read(`${HERE}/value-fixes.json`);
const additions = read(`${HERE}/additions.json`);

const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('$')));
const redirectOf = strip(redirects);
const resolved = strip(resolutions);
const fixed = strip(valueFixes);
const added = strip(additions);

// ---------------------------------------------------------------------------
// 1. Collect every old key under its new name, per side.
// ---------------------------------------------------------------------------
/** newKey -> { client?: {es,en,pt}, server?: {es,en,pt} } */
const collected = new Map();

for (const dir of OLD) {
  const side = dir.includes('client-web') ? 'client' : 'server';
  const perLanguage = Object.fromEntries(
    LANGUAGES.map((l) => [l, Object.fromEntries(flat(read(`${dir}/${l}.json`)))]),
  );
  for (const oldKey of Object.keys(perLanguage.es)) {
    const newKey = renameMap[oldKey];
    if (!newKey) throw new Error(`No rename mapping for ${oldKey}`);
    const entry = collected.get(newKey) ?? {};
    entry[side] = Object.fromEntries(LANGUAGES.map((l) => [l, perLanguage[l][oldKey]]));
    collected.set(newKey, entry);
  }
}

// ---------------------------------------------------------------------------
// 2. Apply redirects: a duplicate is dropped, a rename is moved.
// ---------------------------------------------------------------------------
let dropped = 0;
let moved = 0;
for (const [from, to] of Object.entries(redirectOf)) {
  if (!collected.has(from)) continue;
  if (collected.has(to)) {
    collected.delete(from);
    dropped++;
  } else {
    collected.set(to, collected.get(from));
    collected.delete(from);
    moved++;
  }
}

// ---------------------------------------------------------------------------
// 3. Merge the two sides into one entry per key.
// ---------------------------------------------------------------------------
const source = new Map();
const unresolved = [];

for (const [key, sides] of collected) {
  if (fixed[key]) { source.set(key, fixed[key]); continue; }
  if (resolved[key]) { source.set(key, resolved[key]); continue; }

  const present = Object.values(sides);
  if (present.length === 1) { source.set(key, present[0]); continue; }

  const [a, b] = present;
  if (LANGUAGES.every((l) => a[l] === b[l])) { source.set(key, a); continue; }
  unresolved.push(key);
}

if (unresolved.length) {
  console.error(`\n${unresolved.length} keys are defined on both sides with different text and have`);
  console.error('no entry in conflict-resolutions.json. Choose a wording for each:\n');
  for (const key of unresolved) {
    console.error(`  ${key}`);
    console.error(`      client: ${collected.get(key).client.es}`);
    console.error(`      server: ${collected.get(key).server.es}`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3b. Keys the code asks for that no catalogue ever defined.
// ---------------------------------------------------------------------------
let addedCount = 0;
for (const [key, entry] of Object.entries(added)) {
  if (source.has(key)) continue;
  source.set(key, entry);
  addedCount++;
}

// ---------------------------------------------------------------------------
// 4. Collapse entries identical in every language into `literal`.
// ---------------------------------------------------------------------------
let literals = 0;
for (const [key, entry] of source) {
  if (entry.literal !== undefined) continue;
  const values = LANGUAGES.map((l) => entry[l]);
  if (values.every((v) => typeof v === 'string') && new Set(values).size === 1) {
    const next = { literal: values[0] };
    if (entry.note) next.note = entry.note;
    source.set(key, next);
    literals++;
  }
}

// ---------------------------------------------------------------------------
// 5. Write one file per namespace.
// ---------------------------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const byNamespace = new Map();
for (const [key, entry] of [...source].sort(([a], [b]) => a.localeCompare(b))) {
  const namespace = key.split('.')[0];
  if (!byNamespace.has(namespace)) byNamespace.set(namespace, {});
  byNamespace.get(namespace)[key] = entry;
}

for (const [namespace, entries] of [...byNamespace].sort(([a], [b]) => a.localeCompare(b))) {
  fs.writeFileSync(`${OUT}/${namespace}.json`, `${JSON.stringify(entries, null, 2)}\n`);
}

const missing = [...source].filter(([, e]) =>
  e.literal === undefined && LANGUAGES.some((l) => typeof e[l] !== 'string' || !e[l].length));

console.log(`wrote ${byNamespace.size} namespace files, ${source.size} keys`);
console.log(`  duplicates dropped by redirect ${dropped} · keys moved by redirect ${moved}`);
console.log(`  conflicts resolved by hand ${Object.keys(resolved).length} · values corrected ${Object.keys(fixed).length}`);
console.log(`  keys added that no catalogue defined: ${addedCount}`);
console.log(`  entries identical in all languages stored as literal: ${literals}`);
if (missing.length) {
  console.log(`\n${missing.length} entries are missing a language:`);
  missing.slice(0, 20).forEach(([k, e]) => console.log(`   ${k}  ${JSON.stringify(e)}`));
  process.exitCode = 1;
}
