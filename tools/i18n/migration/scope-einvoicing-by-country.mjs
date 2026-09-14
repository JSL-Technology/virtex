/**
 * One-time: put the country in the key of every jurisdiction-specific e-invoicing message.
 *
 * ## What was wrong
 *
 * `einvoicing.*` was flat, and 42 of its messages were about one country's rules: AFIP will not
 * authorise a comprobante without a CUIT, the SII will not stamp a document without its CAF, the
 * CFDI requires the buyer's postal code. The jurisdiction was encoded in the middle of the leaf —
 * `einvoicing.organization_has_no_valid_cuit_afip` — which is not a dimension anything can read.
 *
 * Three things were impossible as a result: loading only the tenant's own regime, checking in CI
 * that a newly supported country has a complete set of messages, and overriding a term for one
 * country without touching the rest.
 *
 * ## How the country is decided
 *
 * Not by reading the Spanish for an authority's name, which would guess. Each key is attributed to
 * the file that references it: the regime adapters live under `einvoicing/regimes/<cc>/`, and the
 * Dominican pipeline is the `ecf-*` services — e-CF is the DGII's standard and predates the
 * per-regime layout, which is why it sits beside them rather than under `regimes/do/`.
 *
 * A key referenced from the shared services — the range register, the certificate vault, the
 * submission queue — stays where it is. Those genuinely apply to every regime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const BASE = `${ROOT}/libs/shared/locales/src/base/einvoicing.json`;

/** Files that identify a jurisdiction, beyond the `regimes/<cc>/` convention. */
const DOMINICAN_PIPELINE = /\/services\/ecf-[a-z-]+\.service\.ts$/;
const REGIME_DIRECTORY = /\/regimes\/([a-z]{2})\//;

const KEY = /['"`](einvoicing\.[a-z0-9_.]+)['"`]/g;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'messages' ? [] : walk(full);
    return /\.(ts|html)$/.test(entry.name) ? [full] : [];
  });
}

const sources = walk(`${ROOT}/apps/backend/api/src`).concat(walk(`${ROOT}/apps/core/client-web/src`));

/** key -> the set of countries the files referencing it belong to. */
const countries = new Map();
for (const file of sources) {
  const text = fs.readFileSync(file, 'utf8');
  const relative = file.replace(`${ROOT}/`, '');
  const regime = REGIME_DIRECTORY.exec(relative)?.[1];
  const country = regime ?? (DOMINICAN_PIPELINE.test(relative) ? 'do' : null);
  if (!country) continue;
  for (const match of text.matchAll(KEY)) {
    if (!countries.has(match[1])) countries.set(match[1], new Set());
    countries.get(match[1]).add(country);
  }
}

const entries = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const renames = new Map();
for (const [key, found] of countries) {
  if (!(key in entries)) continue;
  // A message reached from two regimes is genuinely shared, whatever it mentions.
  if (found.size !== 1) continue;
  const country = [...found][0];
  const leaf = key.slice('einvoicing.'.length);
  if (leaf.startsWith(`${country}.`)) continue;
  renames.set(key, `einvoicing.${country}.${leaf}`);
}

if (!renames.size) {
  console.log('Every jurisdiction-specific e-invoicing key already names its country.');
  process.exit(0);
}

// --- the catalogue -------------------------------------------------------
const next = {};
for (const [key, entry] of Object.entries(entries)) next[renames.get(key) ?? key] = entry;
fs.writeFileSync(
  BASE,
  `${JSON.stringify(Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`,
);

// --- every reference -----------------------------------------------------
const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', '.nx', 'base', 'regional', 'migration', '_shots']);
const SKIP_PATHS = new Set([
  'apps/core/client-web/src/assets/i18n',
  'apps/backend/api/src/app/i18n/messages',
  'apps/pos/src/assets/i18n',
  'apps/desktop/src/i18n',
]);

function walkAll(dir) {
  const relative = path.relative(ROOT, dir).split(path.sep).join('/');
  if (SKIP_PATHS.has(relative)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : walkAll(full);
    return /\.(ts|html|hbs|mjs|json)$/.test(entry.name) ? [full] : [];
  });
}

const ordered = [...renames].sort(([a], [b]) => b.length - a.length);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let files = 0;
let references = 0;

for (const file of ['apps', 'libs'].flatMap((d) => walkAll(`${ROOT}/${d}`))) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const [from, to] of ordered) {
    const re = new RegExp(`(?<![A-Za-z0-9_.])${escape(from)}(?![A-Za-z0-9_])`, 'g');
    after = after.replace(re, () => {
      references++;
      return to;
    });
  }
  if (after !== before) {
    fs.writeFileSync(file, after);
    files++;
  }
}

const perCountry = new Map();
for (const to of renames.values()) {
  const country = to.split('.')[1];
  perCountry.set(country, (perCountry.get(country) ?? 0) + 1);
}

console.log(`scoped ${renames.size} keys to a country`);
for (const [country, count] of [...perCountry].sort()) console.log(`   einvoicing.${country}.*  ${count}`);
console.log(`  references rewritten: ${references} in ${files} files`);
console.log(`  left shared: ${Object.keys(entries).length - renames.size}`);
