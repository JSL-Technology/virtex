#!/usr/bin/env node
/**
 * Builds `en.json` and `pt.json` from `es.json` plus a glossary.
 *
 *   node tools/i18n/apply-glossary.mjs --report    # what is still untranslated
 *   node tools/i18n/apply-glossary.mjs             # write the catalogues
 *
 * ## Why a glossary keyed on the SPANISH VALUE
 *
 * 3,145 keys across the two catalogues hold 2,510 distinct strings: "Guardar", "Cancelar",
 * "Nombre" and "Acciones" appear dozens of times each. Translating per key would mean translating
 * "Guardar" forty times and getting a different answer on some of them — which is how an interface
 * ends up saying Save on one screen and Store on the next.
 *
 * One entry per distinct string also makes the product's vocabulary reviewable: the glossary IS
 * the terminology list, and a disagreement about how to say "asiento contable" is one line to
 * change rather than a search across two applications.
 *
 * ## Where one word needs two translations
 *
 * "Estado" is *status* on an invoice and *state* in an address. Value-level translation cannot
 * see the difference, so `overrides` names the exceptions BY KEY and wins over the glossary.
 * Keeping them separate keeps the exception list short and honest: a growing override list is a
 * signal that a term is genuinely ambiguous and should be reworded in Spanish too.
 *
 * ## What this tool must never do: throw a translation away
 *
 * It used to rebuild `en.json` and `pt.json` from `es.json` alone. A key the glossary had no term
 * for was written back AS THE SPANISH — so every translation written by hand was destroyed the
 * next time the tool ran, and CI (which runs it and fails on any diff) made accepting that
 * destruction the only way to get a green build. `"Cash and equivalents"` became
 * `"Efectivo y equivalentes"`, in the English catalogue, and the build called it correct.
 *
 * The order of precedence is now:
 *
 *   1. `overrides[key][language]` — an explicit decision about one key.
 *   2. `terms[spanishValue][language]` — the glossary, which is what keeps the vocabulary
 *      consistent and is therefore allowed to correct a one-off wording.
 *   3. The value already in the target catalogue, when it is not simply a copy of the Spanish.
 *   4. The Spanish, carried so the file stays parseable, and reported as missing.
 *
 * Step 3 is the one that was absent. It also means the existing catalogues seed the work: a
 * string translated once stays translated without anyone adding it to the glossary.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CATALOGUES = [
  {
    name: 'client',
    dir: 'apps/core/client-web/src/assets/i18n',
  },
  {
    name: 'server',
    dir: 'apps/backend/api/src/app/i18n/messages',
  },
];

const GLOSSARY = 'tools/i18n/glossary.json';
const REPORT = process.argv.includes('--report');
const LANGUAGES = ['en', 'pt'];

function flatten(tree, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, path, out);
    } else {
      out.set(path, String(value));
    }
  }
  return out;
}

/**
 * Rebuild the nested shape, in the order the entries arrive — which is `es.json`'s own order.
 *
 * This used to re-sort with `localeCompare`, which disagrees with the order the extractors write
 * `es.json` in (it ignores the underscore, so `ES_CUENTA` sorts before `ESTABLECE` where a plain
 * comparison puts it after). The three catalogues then could not be read side by side, and every
 * run produced a reordering diff on top of whatever had actually changed.
 */
function nest(flat) {
  const tree = {};
  for (const [key, value] of flat.entries()) {
    const parts = key.split('.');
    let node = tree;
    for (const part of parts.slice(0, -1)) {
      if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
      node = node[part];
    }
    node[parts.at(-1)] = value;
  }
  return tree;
}

const glossary = JSON.parse(readFileSync(GLOSSARY, 'utf8'));
const terms = glossary.terms ?? {};
const overrides = glossary.overrides ?? {};

const missing = { en: new Map(), pt: new Map() };
let written = 0;

for (const catalogue of CATALOGUES) {
  const spanish = flatten(JSON.parse(readFileSync(join(catalogue.dir, 'es.json'), 'utf8')));

  for (const language of LANGUAGES) {
    const translated = new Map();
    // What the catalogue already says. A key absent from `es.json` is dropped, as before; a key
    // whose translation is already there is kept rather than overwritten with Spanish.
    const existing = flatten(
      JSON.parse(readFileSync(join(catalogue.dir, `${language}.json`), 'utf8')),
    );

    for (const [key, value] of spanish) {
      const override = overrides[key]?.[language];
      if (override !== undefined) {
        translated.set(key, override);
        continue;
      }
      const term = terms[value]?.[language];
      if (term !== undefined) {
        translated.set(key, term);
        continue;
      }
      const already = existing.get(key);
      if (already !== undefined && already !== value) {
        translated.set(key, already);
        continue;
      }
      // Untranslated: reported, and the Spanish is carried so the file stays parseable and the
      // parity spec fails on the "not a copy of the reference" budget rather than on a crash.
      translated.set(key, value);
      const seen = missing[language].get(value) ?? [];
      missing[language].set(value, [...seen, key]);
    }

    if (!REPORT) {
      writeFileSync(
        join(catalogue.dir, `${language}.json`),
        `${JSON.stringify(nest(translated), null, 2)}\n`,
      );
      written++;
    }
  }
}

for (const language of LANGUAGES) {
  const values = [...missing[language].keys()];
  console.log(`${language}: ${values.length} distinct strings still untranslated`);
}
if (!REPORT) console.log(`wrote ${written} catalogues`);

if (REPORT) {
  const language = process.argv.includes('--pt') ? 'pt' : 'en';
  const limit = Number(process.argv.find((a) => /^--limit=\d+$/.test(a))?.split('=')[1] ?? 60);
  const offset = Number(process.argv.find((a) => /^--offset=\d+$/.test(a))?.split('=')[1] ?? 0);
  const entries = [...missing[language].entries()].slice(offset, offset + limit);
  console.log(`\n--- ${language}, ${offset}..${offset + entries.length} ---`);
  for (const [value, keys] of entries) {
    console.log(`${JSON.stringify(value)}\t# ${keys[0]}`);
  }
}
