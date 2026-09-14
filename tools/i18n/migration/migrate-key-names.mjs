/**
 * One-time: rewrite every reference to a catalogue key, everywhere.
 *
 * ## Three shapes a reference takes
 *
 *  1. A whole key written out: `translate.instant('ACCOUNTING.LEDGER.TITLE')`, `| translate`,
 *     `titleKey: 'PAGE_TITLES.PRODUCTS'`, `new NotFoundError('USERS.EMAIL_IN_USE')`.
 *  2. A PREFIX, with the leaf composed at runtime: `` `FISCAL.DO.${code}` `` or
 *     `'PAYROLL.RUNS.TYPE_LABEL.' + run.runType`. The prefix has to move with its children, and
 *     a prefix is only rewritten where it is immediately followed by a dot and the end of the
 *     string — never on its own, because `'AUTH'` as a bare word is a dozen other things.
 *  3. A redirect: the eight authentication messages that existed a second time under
 *     `LOGIN.ERRORS.*`. Those point at the canonical key, so the sign-in screen stops having its
 *     own wording for a failure the rest of the product already words.
 *
 * ## Why longest-first matters
 *
 * `AUTH.PLAN_NOT_FOUND` is a prefix of nothing, but `ACCOUNTING.PERIODS` is a prefix of
 * `ACCOUNTING.PERIODS.STATUS_OPEN`. Replacing the short one first would leave
 * `accounting.periods.STATUS_OPEN` — half migrated, and still matching nothing. Sorting by
 * descending length means a longer key is always consumed before any of its own prefixes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const renameMap = read(`${HERE}/rename-map.json`);
const redirects = Object.fromEntries(
  Object.entries(read(`${HERE}/key-redirects.json`)).filter(([k]) => !k.startsWith('$')),
);

// ---------------------------------------------------------------------------
// Full-key mappings, with redirects folded in.
// ---------------------------------------------------------------------------
const fullKeys = new Map();
for (const [oldKey, newKey] of Object.entries(renameMap)) {
  fullKeys.set(oldKey, redirects[newKey] ?? newKey);
}

// ---------------------------------------------------------------------------
// Prefix mappings, derived rather than declared.
// ---------------------------------------------------------------------------
/**
 * A prefix moves only if every key under it moves consistently — same depth, same new parent.
 * Anything else means the children were regrouped and a composed call site has to be looked at
 * by hand, so it is reported instead of guessed at.
 */
const prefixCandidates = new Map();
for (const [oldKey, newKey] of fullKeys) {
  const oldSegments = oldKey.split('.');
  const newSegments = newKey.split('.');
  if (oldSegments.length !== newSegments.length) continue;
  for (let depth = 2; depth < oldSegments.length; depth++) {
    const oldPrefix = oldSegments.slice(0, depth).join('.');
    const newPrefix = newSegments.slice(0, depth).join('.');
    if (!prefixCandidates.has(oldPrefix)) prefixCandidates.set(oldPrefix, new Set());
    prefixCandidates.get(oldPrefix).add(newPrefix);
  }
}
const prefixes = new Map();
const ambiguousPrefixes = [];
for (const [oldPrefix, targets] of prefixCandidates) {
  if (targets.size === 1) prefixes.set(oldPrefix, [...targets][0]);
  else ambiguousPrefixes.push(oldPrefix);
}

// ---------------------------------------------------------------------------
// Files to rewrite.
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.nx', '_shots', 'base', 'regional']);
const EXTENSIONS = /\.(ts|tsx|html|hbs|mjs|cts|json|md)$/;
const SKIP_FILES = new Set([
  'rename-map.json', 'rename-overrides.json', 'key-redirects.json',
  'conflict-resolutions.json', 'value-fixes.json', 'package-lock.json', 'glossary.json',
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(full);
    if (SKIP_FILES.has(entry.name)) return [];
    return EXTENSIONS.test(entry.name) ? [full] : [];
  });
}

const targets = ['apps', 'libs', 'tools', 'platform'].flatMap((d) => walk(`${ROOT}/${d}`));

// Longest first, so a key is always replaced before any prefix of it.
const fullOrdered = [...fullKeys].sort(([a], [b]) => b.length - a.length);
const prefixOrdered = [...prefixes].sort(([a], [b]) => b.length - a.length);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const counts = new Map();
let filesChanged = 0;

for (const file of targets) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;

  // A composed prefix: the key text ends with a dot, then the string ends or an interpolation
  // begins. Done before whole keys so `'PAYROLL.RUNS.TYPE_LABEL.'` is not left half-rewritten.
  for (const [oldPrefix, newPrefix] of prefixOrdered) {
    const re = new RegExp(`(?<![A-Za-z0-9_.])${escape(oldPrefix)}\\.(?=['"\`]|\\$\\{)`, 'g');
    after = after.replace(re, () => {
      counts.set(oldPrefix, (counts.get(oldPrefix) ?? 0) + 1);
      return `${newPrefix}.`;
    });
  }

  for (const [oldKey, newKey] of fullOrdered) {
    const re = new RegExp(`(?<![A-Za-z0-9_.])${escape(oldKey)}(?![A-Za-z0-9_])`, 'g');
    after = after.replace(re, () => {
      counts.set(oldKey, (counts.get(oldKey) ?? 0) + 1);
      return newKey;
    });
  }

  // A prefix used bare as a group name, inside a declaration of runtime-composed keys.
  for (const [oldPrefix, newPrefix] of prefixOrdered) {
    const re = new RegExp(`(['"\`])${escape(oldPrefix)}\\1`, 'g');
    after = after.replace(re, (_, quote) => {
      counts.set(oldPrefix, (counts.get(oldPrefix) ?? 0) + 1);
      return `${quote}${newPrefix}${quote}`;
    });
  }

  if (after !== before) {
    fs.writeFileSync(file, after);
    filesChanged++;
  }
}

console.log(`rewrote ${filesChanged} files`);
console.log(`  distinct keys/prefixes replaced: ${counts.size}  (${[...counts.values()].reduce((a, b) => a + b, 0)} occurrences)`);
if (ambiguousPrefixes.length) {
  console.log(`\n${ambiguousPrefixes.length} prefixes were regrouped and are NOT rewritten automatically:`);
  ambiguousPrefixes.slice(0, 20).forEach((p) => console.log(`   ${p} -> ${[...prefixCandidates.get(p)].join(' | ')}`));
}
