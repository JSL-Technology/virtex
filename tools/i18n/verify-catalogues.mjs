/**
 * Everything that has to stay true about the translations, checked in one place.
 *
 * ## Why one script and not six
 *
 * The checks that existed before this were spread across three specs and two scripts, each reading
 * the catalogues its own way, and between them they still let all of the following ship:
 *
 *  - 1.883 keys whose segments were Spanish, because nothing said what a key looks like;
 *  - 23 values where the Spanish entry held English text — parity passed, since the key was present
 *    in all three files and only a human could see the language was wrong;
 *  - four composed key families (`settings.fiscal.capability.*`, `billing.subscription_status.*`
 *    and two more) that resolved to nothing, so the missing-translation handler humanised the last
 *    segment and a Spanish screen read "Past due";
 *  - two keys used in production code and defined nowhere — `auth.impersonation.started` and
 *    `.stopped`, on the notice that says an administrator is impersonating a user;
 *  - 386 keys nothing referenced, reported but never failed, so the count only ever rose.
 *
 * Each check below exists because something in that list got through.
 *
 *     node tools/i18n/verify-catalogues.mjs
 *     node tools/i18n/verify-catalogues.mjs --json     # machine-readable summary
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEY_PATTERN, PLURAL_SUFFIXES, normaliseSegment } from './lib/keys.mjs';
import { LANGUAGES, OUTPUTS, loadSource, loadRegional, loadTargets, valueFor } from './build-catalogues.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SOURCE = `${ROOT}/libs/shared/locales/src`;

const failures = [];
const notes = [];
const fail = (check, detail) => failures.push({ check, detail });

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
const source = loadSource();
const regional = loadRegional();
const targets = loadTargets();
const composedFile = JSON.parse(fs.readFileSync(`${SOURCE}/composed-keys.json`, 'utf8'));
const composed = composedFile.families;
/** Prefixes that look like keys and are not — see `not_keys_note` in that file. */
const NOT_KEY_PREFIXES = new Set(composedFile.not_keys ?? []);

/** The catalogue's spelling of a key composed from data. Mirrors `normalizeKey` in shared/types. */
function normalizeKey(key) {
  if (KEY_PATTERN.test(key)) return key;
  return key.split('.').map(normaliseSegment).filter(Boolean).join('.');
}

// ---------------------------------------------------------------------------
// 1. Every key follows the convention.
// ---------------------------------------------------------------------------
for (const key of Object.keys(source)) {
  if (!KEY_PATTERN.test(key)) {
    fail('key convention', `${key} is not dot-separated lower_snake`);
  }
}

// ---------------------------------------------------------------------------
// 2. Every key has every language, or says it is the same in all of them.
// ---------------------------------------------------------------------------
for (const [key, entry] of Object.entries(source)) {
  if (entry.literal !== undefined) {
    if (typeof entry.literal !== 'string' || !entry.literal.length) {
      fail('empty literal', `${key} declares a literal with no value`);
    }
    continue;
  }
  for (const language of LANGUAGES) {
    if (typeof entry[language] !== 'string' || !entry[language].length) {
      fail('missing language', `${key} has no ${language} value`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. The three languages agree about which placeholders a message has.
// ---------------------------------------------------------------------------
const placeholdersOf = (text) =>
  [...String(text).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();

for (const [key, entry] of Object.entries(source)) {
  if (entry.literal !== undefined) continue;
  const [first, ...rest] = LANGUAGES;
  const expected = placeholdersOf(entry[first]).join(',');
  for (const language of rest) {
    const actual = placeholdersOf(entry[language]).join(',');
    if (actual !== expected) {
      fail(
        'placeholder mismatch',
        `${key}: ${first} has [${expected}] and ${language} has [${actual}] — a message that drops ` +
          'a parameter renders the literal {{name}} to a reader',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 4. A value in the wrong language.
// ---------------------------------------------------------------------------
/**
 * Telling the three languages apart.
 *
 * A Spanish entry holding English text passes every structural check — the key is present in all
 * three files — so this is the only thing that catches it, and it is what let 23 of them ship.
 *
 * Three things make this harder than a word list:
 *
 *  - Spanish and Portuguese share most of their function words, so a naive list reports half the
 *    Portuguese catalogue as Spanish. Orthography separates them: `ñ`, `¿` and `¡` occur in Spanish
 *    and not Portuguese; `ã`, `õ`, `ç` and `ê` occur in Portuguese and not Spanish; and the
 *    `-ción` / `-ção` pair is decisive on its own.
 *  - Some words exist in both with different meanings. Spanish `dos` is the number two while
 *    Portuguese `dos` is a contraction; Spanish `has` is a verb and so is English `has`. Those are
 *    left out entirely rather than weighted.
 *  - JavaScript's `\b` is ASCII, so `leídos` has a word boundary before `dos` — which is how the
 *    first version of this check reported a dozen correct Spanish sentences as Portuguese. The
 *    boundaries here are Unicode letter lookarounds.
 *
 * Two distinct foreign markers are required before failing. One is a loan word, a proper noun or a
 * legal document's name — the Mexican "Constancia de Situación Fiscal" appears verbatim in the
 * Portuguese help text and should.
 */
const B = (words) => new RegExp(`(?<!\\p{L})(?:${words})(?!\\p{L})`, 'iu');

const EXCLUSIVE = {
  es: [/[ñ¿¡]/u, /ción(?!\p{L})/iu, B('el|una|muy|pero|hay|más|año|años|aún|También')],
  en: [B('the|is|are|was|were|been|must|cannot|should|would|your|with|this|that|which|there|and')],
  pt: [/[ãõçê]/u, /ção(?!\p{L})/iu, /ções(?!\p{L})/iu, B('não|você|já|até|são|então|muito|seu|sua')],
};

/** How many distinct exclusive markers of a language a text carries. */
const score = (text, language) =>
  EXCLUSIVE[language].filter((pattern) => pattern.test(text)).length;

for (const [key, entry] of Object.entries(source)) {
  if (entry.literal !== undefined) continue;
  for (const language of LANGUAGES) {
    const text = entry[language];
    // Short strings and strings that are mostly interpolation say nothing about their language.
    const words = text.replace(/\{\{[^}]*\}\}/g, ' ').match(/[\p{L}]{2,}/gu) ?? [];
    if (words.length < 4) continue;

    // Its own markers present settles it, whatever else the text contains.
    if (score(text, language) > 0) continue;

    const foreign = LANGUAGES.filter((other) => other !== language && score(text, other) >= 2);
    if (foreign.length === 1) {
      fail(
        'wrong language',
        `${key}: the ${language} value reads as ${foreign[0]} — "${text.slice(0, 70)}"`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Regional patches only name keys that exist.
// ---------------------------------------------------------------------------
for (const [locale, patch] of Object.entries(regional)) {
  for (const key of Object.keys(patch)) {
    if (!(key in source)) {
      fail('stale regional override', `${locale} overrides ${key}, which the base catalogue has not`);
    }
  }
  if (!Object.keys(patch).length) {
    notes.push(`regional/${locale}.json overrides nothing and can be deleted`);
  }
}

// ---------------------------------------------------------------------------
// 6. What the code asks for.
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.nx', '_shots']);

/**
 * The generated catalogues, excluded by PATH rather than by directory name.
 *
 * Excluding any directory called `i18n` was the obvious shortcut and it was wrong: it also skipped
 * `apps/backend/api/src/app/i18n/` and `apps/core/client-web/src/app/core/i18n/`, which is where the
 * i18n runtime lives. Keys referenced only from there — `errors.not_found` and `errors.forbidden`, in
 * the exception filter — looked unreferenced, and `--prune` deleted them.
 */
const SKIP_PATHS = new Set([
  'apps/core/client-web/src/assets/i18n',
  'apps/backend/api/src/app/i18n/messages',
  'apps/pos/src/assets/i18n',
  'apps/desktop/src/i18n',
]);

function walk(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  const relative = path.relative(ROOT, dir).split(path.sep).join('/');
  if (SKIP_PATHS.has(relative)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(full, extensions);
    return extensions.test(entry.name) ? [full] : [];
  });
}

/**
 * Every literal that is used as a catalogue key.
 *
 * Deliberately generous: a dotted lower_snake string in quotes is treated as a key wherever it
 * appears. A false positive is a key somebody has to add or a line somebody has to look at; a false
 * negative is a missing translation that reaches a customer.
 */
const KEY_LITERAL = /['"`]([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)['"`]/g;
/**
 * A whole key written out.
 *
 * The dotted tail is optional because a handful of keys are a single segment — `app_title` is the
 * product's own name, referenced as `'app_title' | translate`. Requiring two segments is what made
 * the first version of this check report it as an orphan.
 */
const KEY_PREFIX = /['"`]([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)\.['"`]|`([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)\.\$\{/g;
/** `composeKey('prefix', …)` — the explicit form. */
const COMPOSE_CALL = /composeKey\(\s*['"`]([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)['"`]/g;

const APP_ROOTS = {
  'client-web': `${ROOT}/apps/core/client-web/src`,
  api: `${ROOT}/apps/backend/api/src`,
  pos: `${ROOT}/apps/pos/src`,
  desktop: `${ROOT}/apps/desktop/src`,
};

/**
 * Shared code that names keys without being an application.
 *
 * `libs/shared/ui-i18n` holds the runtime both browser applications use, and it names keys directly:
 * `errors.network` in `resolveErrorKey`, for one. Leaving `libs/` out of the scan made those look
 * unreferenced, and `--prune` deleted them. Read for the orphan check, not attributed to any single
 * application's catalogue.
 */
const SHARED_ROOTS = [`${ROOT}/libs`];

/** Namespaces that are not keys: paths, mime types, package names and the like. */
const NOT_KEYS = /^(?:node|rxjs|zone|jest|process|window|document|console|import|export|https?|data|text|application|image|font|audio|video|multipart|charset|utf|en|es|pt)\b/;

const referenced = {};
for (const [app, root] of Object.entries({ ...APP_ROOTS, shared: SHARED_ROOTS[0] })) {
  const seen = new Map();
  for (const file of walk(root, /\.(ts|html|hbs|js)$/)) {
    if (/\.spec\.ts$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const record = (key) => {
      if (!key || NOT_KEYS.test(key)) return;
      // A quoted word with no dot is usually an object property or an enum value, not a key. Only
      // the handful the catalogue actually defines that way count — `app_title` is the product name.
      if (!key.includes('.') && !(key in source)) return;
      if (!seen.has(key)) seen.set(key, path.relative(ROOT, file));
    };
    for (const m of text.matchAll(KEY_LITERAL)) record(m[1]);
    for (const m of text.matchAll(COMPOSE_CALL)) record(`${m[1]}.*`);
    for (const m of text.matchAll(KEY_PREFIX)) record(`${m[1] ?? m[2]}.*`);
  }
  referenced[app] = seen;
}

/** The keys each application's catalogue actually contains. */
const emitted = Object.fromEntries(
  Object.entries(targets).map(([app, namespaces]) => {
    const owned = new Set(namespaces);
    return [app, new Set(Object.keys(source).filter((k) => owned.has(k.split('.')[0])))];
  }),
);

/** Every key a composed family can resolve to, in the catalogue's own spelling. */
const composedKeys = new Set();
const openFamilies = new Set();
for (const [prefix, values] of Object.entries(composed)) {
  if (!values.length) {
    openFamilies.add(prefix);
    continue;
  }
  for (const value of values) composedKeys.add(normalizeKey(`${prefix}.${value}`));
}

// 6a. Every whole key a file names must be in that application's catalogue.
for (const [app, seen] of Object.entries(referenced)) {
  const catalogue = emitted[app];
  // `shared` is not an application and ships no catalogue; its references count for the orphan
  // check and cannot be checked against a target.
  if (!catalogue) continue;
  for (const [key, file] of seen) {
    if (key.endsWith('.*')) continue;
    if (catalogue.has(key)) continue;
    // A plural base resolves through its CLDR suffixes rather than on its own.
    if (PLURAL_SUFFIXES.some((s) => catalogue.has(`${key}_${s}`))) continue;
    // Not every dotted string is a key. One that no catalogue anywhere defines is almost certainly
    // something else — a property path, a route, a feature flag — so only a key the SOURCE knows
    // and this application's catalogue lacks is a routing mistake worth failing on.
    if (key in source) {
      fail(
        'key not shipped to the app that uses it',
        `${app} references ${key} (${file}) but targets.json does not give it the ` +
          `"${key.split('.')[0]}" namespace`,
      );
    }
  }
}

// 6b. Every family a file composes must be declared, or its completeness cannot be checked.
for (const [app, seen] of Object.entries(referenced)) {
  for (const [key, file] of seen) {
    if (!key.endsWith('.*')) continue;
    const prefix = key.slice(0, -2);
    if (prefix in composed) continue;
    if (NOT_KEY_PREFIXES.has(prefix.split('.')[0])) continue;
    // Only complain when the prefix looks like a real catalogue branch.
    const hasChildren = Object.keys(source).some((k) => k.startsWith(`${prefix}.`));
    if (!hasChildren) continue;
    fail(
      'undeclared composed family',
      `${app} composes ${prefix}.<value> (${file}) but composed-keys.json does not declare it, so ` +
        'nothing verifies the values exist and the keys read as orphans',
    );
  }
}

// 6c. Every value a declared family can produce must exist.
for (const [prefix, values] of Object.entries(composed)) {
  if (!values.length) continue;
  for (const value of values) {
    const key = normalizeKey(`${prefix}.${value}`);
    if (!(key in source)) {
      fail(
        'composed key missing',
        `composed-keys.json declares ${prefix}.${value}, which resolves to ${key} and is not defined`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Keys nothing references.
// ---------------------------------------------------------------------------
const allReferenced = new Set();
for (const seen of Object.values(referenced)) {
  for (const key of seen.keys()) allReferenced.add(key);
}

const orphans = [];
for (const key of Object.keys(source)) {
  if (allReferenced.has(key)) continue;
  if (composedKeys.has(key)) continue;
  if ([...openFamilies].some((prefix) => key.startsWith(`${prefix}.`))) continue;
  // A plural variant is reached through its base.
  const withoutSuffix = key.replace(new RegExp(`_(${PLURAL_SUFFIXES.join('|')})$`), '');
  if (withoutSuffix !== key && allReferenced.has(withoutSuffix)) continue;
  // A parent whose whole branch is composed.
  if ([...allReferenced].some((ref) => ref.endsWith('.*') && key.startsWith(ref.slice(0, -1)))) continue;
  orphans.push(key);
}

/**
 * `--prune` deletes them.
 *
 * Kept behind a flag rather than done automatically, and with a second, independent check before
 * anything is removed: every candidate is searched for again as an EXACT quoted token across every
 * source file. The reference scan above is pattern-based and a pattern can be wrong; deleting a key
 * that is actually used turns into a dotted identifier on a customer's screen, so the cost of being
 * wrong here is not symmetric and one more pass is cheap.
 */
if (orphans.length && process.argv.includes('--prune')) {
  const quoted = new RegExp(
    `['"\`](${orphans.map((k) => k.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')).join('|')})['"\`]`,
    'g',
  );
  const stillUsed = new Set();
  for (const [, root] of Object.entries(APP_ROOTS)) {
    for (const file of walk(root, /\.(ts|html|hbs|js)$/)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(quoted)) stillUsed.add(m[1]);
    }
  }

  const removable = orphans.filter((k) => !stillUsed.has(k));
  let removed = 0;
  for (const file of fs.readdirSync(`${SOURCE}/base`)) {
    if (!file.endsWith('.json')) continue;
    const full = `${SOURCE}/base/${file}`;
    const entries = JSON.parse(fs.readFileSync(full, 'utf8'));
    const next = Object.fromEntries(
      Object.entries(entries).filter(([key]) => !removable.includes(key)),
    );
    const gone = Object.keys(entries).length - Object.keys(next).length;
    if (!gone) continue;
    removed += gone;
    if (Object.keys(next).length) {
      fs.writeFileSync(full, `${JSON.stringify(next, null, 2)}\n`);
    } else {
      fs.rmSync(full);
    }
  }
  // A patch that overrides a key the base no longer has is stale by construction, so the regional
  // files are cleaned in the same pass rather than left for the next run to complain about.
  let patchesCleaned = 0;
  for (const file of fs.readdirSync(`${SOURCE}/regional`)) {
    if (!file.endsWith('.json')) continue;
    const full = `${SOURCE}/regional/${file}`;
    const entries = JSON.parse(fs.readFileSync(full, 'utf8'));
    const next = Object.fromEntries(
      Object.entries(entries).filter(([key]) => key.startsWith('$') || !removable.includes(key)),
    );
    const gone = Object.keys(entries).length - Object.keys(next).length;
    if (!gone) continue;
    patchesCleaned += gone;
    fs.writeFileSync(full, `${JSON.stringify(next, null, 2)}\n`);
  }

  console.log(`pruned ${removed} orphan keys`);
  if (patchesCleaned) console.log(`  regional overrides dropped with them: ${patchesCleaned}`);
  if (stillUsed.size) {
    console.log(`  kept ${stillUsed.size} the reference scan had missed:`);
    for (const key of [...stillUsed].slice(0, 20)) console.log(`     ${key}`);
  }
  console.log('  run `node tools/i18n/build-catalogues.mjs` to regenerate the catalogues');
  process.exit(0);
}

if (orphans.length) {
  fail(
    'orphan keys',
    `${orphans.length} keys are defined and referenced by nothing. Delete them, or declare the ` +
      `family in composed-keys.json if the leaf is built at runtime:\n       ` +
      orphans.slice(0, 40).join('\n       ') +
      (orphans.length > 40 ? `\n       … and ${orphans.length - 40} more` : ''),
  );
}

// ---------------------------------------------------------------------------
// 8. The generated catalogues match the source.
// ---------------------------------------------------------------------------
for (const [app, dir] of Object.entries(OUTPUTS)) {
  if (!targets[app]) continue;
  for (const language of LANGUAGES) {
    const file = `${dir}/${language}.json`;
    if (!fs.existsSync(file)) {
      fail('catalogue not generated', `${path.relative(ROOT, file)} is missing`);
      continue;
    }
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of emitted[app]) {
      const expected = valueFor(source[key], language);
      if (onDisk[key] !== expected) {
        fail(
          'catalogue out of date',
          `${path.relative(ROOT, file)} disagrees with the source at ${key}. Run ` +
            '`node tools/i18n/build-catalogues.mjs`',
        );
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const summary = {
  keys: Object.keys(source).length,
  namespaces: new Set(Object.keys(source).map((k) => k.split('.')[0])).size,
  locales: Object.keys(regional).length,
  composedFamilies: Object.keys(composed).length,
  referenced: allReferenced.size,
  failures: failures.length,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary, failures, notes }, null, 2));
} else {
  console.log(
    `${summary.keys} keys · ${summary.namespaces} namespaces · ${summary.locales} regional patches · ` +
      `${summary.composedFamilies} composed families`,
  );
  for (const note of notes) console.log(`  note: ${note}`);
  if (failures.length) {
    console.error(`\n${failures.length} problems:\n`);
    const byCheck = new Map();
    for (const { check, detail } of failures) {
      if (!byCheck.has(check)) byCheck.set(check, []);
      byCheck.get(check).push(detail);
    }
    for (const [check, details] of byCheck) {
      console.error(`  ${check} (${details.length})`);
      for (const detail of details.slice(0, 25)) console.error(`     ${detail}`);
      if (details.length > 25) console.error(`     … and ${details.length - 25} more`);
    }
  } else {
    console.log('\nAll checks passed.');
  }
}

process.exit(failures.length ? 1 : 0);
