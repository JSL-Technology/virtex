/**
 * One-time: put the enum back in the leaf of every composed key family.
 *
 * ## The mistake this repairs
 *
 * `migrate-key-names.mjs` rebuilt a non-English leaf from the key's ENGLISH VALUE, which is the right
 * rule for a key somebody writes out and the wrong one for a key whose leaf is composed at runtime.
 * For a composed family the leaf is not a name anybody chose — it IS the enum value the API returns,
 * and it has to keep matching it:
 *
 *     ACCOUNTING.CATEGORIES.OWNERS_EQUITY   value "Capital"   became  accounting.categories.capital
 *     COMMON.TOAST.INFO                     value "Information"       common.toast.information
 *     HCM.EMPLOYEES.STATUS_LABEL.ON_LEAVE   value "De baja"           hcm.employees.status_label.left
 *
 * so `accounting.categories.${section.category}` composed `accounting.categories.OWNERS_EQUITY`,
 * normalised to `accounting.categories.owners_equity`, and found nothing. The balance sheet would
 * have rendered "Owners equity" — the humanised fallback — in all three languages.
 *
 * The repair is mechanical: for every key under a declared family, the leaf is the OLD leaf,
 * lowercased, rather than anything derived from the text. Only the catalogue moves; a composed call
 * site names the prefix and never the leaf, so nothing in the code has to change — except the few
 * places that also happen to write one of these keys out in full, which are rewritten too.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseSegment, splitPlural } from '../lib/keys.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const BASE = `${ROOT}/libs/shared/locales/src/base`;

const renameMap = JSON.parse(fs.readFileSync(`${HERE}/rename-map.json`, 'utf8'));
const families = JSON.parse(
  fs.readFileSync(`${ROOT}/libs/shared/locales/src/composed-keys.json`, 'utf8'),
).families;

/** newKey -> oldKey, so a family's members can be found by their new prefix. */
const reverse = new Map(Object.entries(renameMap).map(([oldKey, newKey]) => [newKey, oldKey]));

/**
 * Keys that sit at a family's level without being members of it.
 *
 * `dashboard.financial_ratios` is an OPEN family: its members are `<ratioKey>.name` and
 * `<ratioKey>.tooltip`, two levels down. The heading above them is an ordinary key that happens to
 * be a direct child, and treating it as an enum value would have restored its Spanish leaf.
 */
const NOT_FAMILY_MEMBERS = new Set([
  'dashboard.financial_ratios.key_financial_indicators',
]);

const corrections = new Map();

for (const prefix of Object.keys(families)) {
  for (const [newKey, oldKey] of reverse) {
    if (!newKey.startsWith(`${prefix}.`)) continue;
    const relative = newKey.slice(prefix.length + 1);
    // Only a direct child is a family member; a deeper path is a different branch.
    if (relative.includes('.')) continue;
    if (NOT_FAMILY_MEMBERS.has(newKey)) continue;

    const oldLeaf = oldKey.split('.').pop();
    const [stem, plural] = splitPlural(oldLeaf);
    const correct = plural
      ? `${prefix}.${normaliseSegment(stem)}_${plural}`
      : `${prefix}.${normaliseSegment(stem)}`;

    if (correct !== newKey) corrections.set(newKey, correct);
  }
}

if (!corrections.size) {
  console.log('Every composed family already keeps its enum in the leaf.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Apply to the source catalogue.
// ---------------------------------------------------------------------------
let movedEntries = 0;
for (const file of fs.readdirSync(BASE)) {
  if (!file.endsWith('.json')) continue;
  const full = `${BASE}/${file}`;
  const entries = JSON.parse(fs.readFileSync(full, 'utf8'));
  let touched = false;
  const next = {};
  for (const [key, entry] of Object.entries(entries)) {
    const correct = corrections.get(key);
    if (correct && correct !== key) {
      next[correct] = entry;
      touched = true;
      movedEntries++;
    } else {
      next[key] = entry;
    }
  }
  if (touched) {
    const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(full, `${JSON.stringify(sorted, null, 2)}\n`);
  }
}

// ---------------------------------------------------------------------------
// Apply to the few call sites that write one of these keys out in full.
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.nx', '_shots', 'base', 'regional', 'migration']);
const SKIP_PATHS = new Set([
  'apps/core/client-web/src/assets/i18n',
  'apps/backend/api/src/app/i18n/messages',
  'apps/pos/src/assets/i18n',
  'apps/desktop/src/i18n',
]);

function walk(dir) {
  const relative = path.relative(ROOT, dir).split(path.sep).join('/');
  if (SKIP_PATHS.has(relative)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(full);
    return /\.(ts|html|hbs|mjs)$/.test(entry.name) ? [full] : [];
  });
}

const ordered = [...corrections].sort(([a], [b]) => b.length - a.length);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let filesChanged = 0;
let references = 0;

for (const file of ['apps', 'libs', 'tools'].flatMap((d) => walk(`${ROOT}/${d}`))) {
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
    filesChanged++;
  }
}

console.log(`corrected ${corrections.size} composed-family leaves`);
console.log(`  catalogue entries moved: ${movedEntries}`);
console.log(`  literal references rewritten: ${references} in ${filesChanged} files`);
for (const [from, to] of [...corrections].slice(0, 25)) console.log(`   ${from}  ->  ${to}`);
if (corrections.size > 25) console.log(`   … and ${corrections.size - 25} more`);
