/**
 * Build every application's message catalogue from the single source.
 *
 * ## What this replaces
 *
 * `apply-glossary.mjs`, which built `en.json` and `pt.json` from `es.json` by looking each SPANISH
 * SENTENCE up in a 3.068-entry table. That made Spanish the axis of the system: two keys sharing a
 * Spanish value shared an English one whether or not they meant the same thing, and the only escape
 * was the five by-key `overrides` somebody had noticed needing. 1.518 client keys and 162 server
 * keys were in that position.
 *
 * Here nothing is derived. `libs/shared/locales/src/base/` holds one entry per key with all three
 * languages together, and this script's only jobs are to select the namespaces each application
 * needs (`targets.json`) and to flatten the regional overrides into per-locale patch files.
 *
 * ## Why the catalogues are flat
 *
 * `@ngx-translate`'s lookup accumulates dotted segments, so a flat `"accounting.ledger.title"` key
 * at the top level resolves exactly as a nested one does. Flat means a key can be found with grep —
 * the old nested shape had `"CANCELAR"` under forty different parents.
 *
 * ## Regional files are patches, not catalogues
 *
 * `regional/es-DO.json` holds only the keys whose Dominican wording differs from neutral Latin
 * American Spanish: nineteen of 5.716. Emitting a whole catalogue per country would multiply the
 * maintenance by the number of markets to express a difference that small, and a country would
 * silently fall behind the base the moment a key was added. A patch cannot fall behind: what it
 * does not mention, it does not change.
 *
 *     node tools/i18n/build-catalogues.mjs          # write
 *     node tools/i18n/build-catalogues.mjs --check  # fail if the result differs from what is committed
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SOURCE = `${ROOT}/libs/shared/locales/src`;

export const LANGUAGES = ['es', 'en', 'pt'];

/** Where each application's catalogue is written. */
export const OUTPUTS = {
  'client-web': `${ROOT}/apps/core/client-web/src/assets/i18n`,
  api: `${ROOT}/apps/backend/api/src/app/i18n/messages`,
  pos: `${ROOT}/apps/pos/src/assets/i18n`,
  desktop: `${ROOT}/apps/desktop/src/i18n`,
};

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const stripMeta = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('$')));

/** Every key in the source, with its languages. Exported so the verifier reads the same thing. */
export function loadSource() {
  const entries = {};
  for (const file of fs.readdirSync(`${SOURCE}/base`).sort()) {
    if (!file.endsWith('.json')) continue;
    for (const [key, entry] of Object.entries(read(`${SOURCE}/base/${file}`))) {
      if (key.startsWith('$')) continue;
      if (entries[key]) throw new Error(`${key} is defined twice in base/ (second time in ${file})`);
      entries[key] = entry;
    }
  }
  return entries;
}

/** The per-locale patches, keyed by locale tag exactly as `SUPPORTED_LOCALES` spells it. */
export function loadRegional() {
  const dir = `${SOURCE}/regional`;
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    out[file.replace(/\.json$/, '')] = stripMeta(read(`${dir}/${file}`));
  }
  return out;
}

export function loadTargets() {
  const raw = read(`${SOURCE}/targets.json`);
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([k]) => !k.startsWith('$'))
      .map(([target, config]) => [target, config.namespaces]),
  );
}

/**
 * The subset an application bundles rather than fetches, per target.
 *
 * Only the web client declares one. Its catalogue is 4.700 keys — it holds the wording of every
 * domain error, because the API names failures and does not word them — and putting that in the
 * initial bundle cost 367 kB of JavaScript to parse before first paint. The full catalogue is a
 * chunk now; `core` is what remains bundled, so a reader whose chunk never arrives still gets a
 * readable sign-in page instead of a screen of dotted identifiers.
 */
export function loadCoreNamespaces() {
  const raw = read(`${SOURCE}/targets.json`);
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([k]) => !k.startsWith('$') && Array.isArray(raw[k].core))
      .map(([target, config]) => [target, config.core]),
  );
}

/** The value of a key in one language: `literal` wins, because it means "the same in all three". */
export function valueFor(entry, language) {
  if (entry.literal !== undefined) return entry.literal;
  return entry[language];
}

function writeIfChanged(file, content, check, changed) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (existing === content) return;
  changed.push(path.relative(ROOT, file));
  if (!check) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

function main() {
  const check = process.argv.includes('--check');
  const source = loadSource();
  const regional = loadRegional();
  const targets = loadTargets();
  const cores = loadCoreNamespaces();
  const changed = [];

  // Keys are written in sorted order so a diff shows a changed translation and never a reshuffle.
  const sortedKeys = Object.keys(source).sort();

  for (const [target, namespaces] of Object.entries(targets)) {
    const dir = OUTPUTS[target];
    if (!dir) throw new Error(`targets.json names "${target}", which has no output directory`);
    const owned = new Set(namespaces);
    const keys = sortedKeys.filter((k) => owned.has(k.split('.')[0]));

    for (const language of LANGUAGES) {
      const catalogue = {};
      for (const key of keys) {
        const value = valueFor(source[key], language);
        if (typeof value !== 'string') {
          throw new Error(`${key} has no ${language} value`);
        }
        catalogue[key] = value;
      }
      writeIfChanged(`${dir}/${language}.json`, `${JSON.stringify(catalogue, null, 2)}\n`, check, changed);

      const core = cores[target];
      if (core) {
        const owned = new Set(core);
        const subset = Object.fromEntries(
          Object.entries(catalogue).filter(([key]) => owned.has(key.split('.')[0])),
        );
        writeIfChanged(`${dir}/${language}.core.json`, `${JSON.stringify(subset, null, 2)}\n`, check, changed);
      }
    }

    // One patch per locale, containing only the keys this target actually ships.
    const patches = {};
    for (const [locale, overrides] of Object.entries(regional)) {
      const relevant = Object.fromEntries(
        Object.entries(overrides).filter(([key]) => owned.has(key.split('.')[0])),
      );
      if (Object.keys(relevant).length) patches[locale] = relevant;
    }
    writeIfChanged(`${dir}/regional.json`, `${JSON.stringify(patches, null, 2)}\n`, check, changed);
  }

  const totals = Object.entries(targets)
    .map(([t, ns]) => `${t} ${sortedKeys.filter((k) => new Set(ns).has(k.split('.')[0])).length}`)
    .join(' · ');
  console.log(`source: ${sortedKeys.length} keys · ${Object.keys(regional).length} regional patches`);
  console.log(`emitted: ${totals}`);

  if (check && changed.length) {
    console.error(`\n${changed.length} generated files differ from the source:`);
    changed.forEach((f) => console.error(`   ${f}`));
    console.error('\nRun `node tools/i18n/build-catalogues.mjs` and commit the result.');
    process.exit(1);
  }
  if (!check && changed.length) console.log(`  ${changed.length} files written`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
