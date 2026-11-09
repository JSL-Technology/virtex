#!/usr/bin/env node
/**
 * Country neutrality ratchet (see `country-neutrality.config.mjs`).
 *
 *   npm run verify:country-neutrality              # fails if any count rose
 *   npm run verify:country-neutrality -- --report  # every occurrence, file:line
 *   npm run verify:country-neutrality -- --update  # lock in a decrease (refuses an increase without --force)
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTRY_TERMS, COUNTRY_CODES, COUNTRY_SCOPED_PATHS, IGNORED_PATHS, COUNTRY_SCOPED_KEY, termPattern } from './country-neutrality.config.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
const BASELINE_PATH = join(HERE, 'country-neutrality.baseline.json');
const args = new Set(process.argv.slice(2));

const SOURCES = [
  { area: 'api', dir: join(ROOT, 'apps/backend/api/src/app'), ext: /\.ts$/ },
  { area: 'web', dir: join(ROOT, 'apps/core/client-web/src/app'), ext: /\.(ts|html)$/ },
];
const LOCALES = join(ROOT, 'libs/shared/locales/src/base');

const termRegex = Object.fromEntries(
  Object.entries(COUNTRY_TERMS).map(([country, stems]) => [country, new RegExp(stems.map(termPattern).join('|'))]),
);
const codes = COUNTRY_CODES.join('|');
const COUNTRY_ROW = new RegExp(`^\\s*['"]?(${codes})['"]?\\s*:`);
const BRANCH = new RegExp(`(?:[!=]==?\\s*['"](${codes})['"])|(?:['"](${codes})['"]\\s*[!=]==?)|(?:case\\s+['"](${codes})['"]\\s*:)`);

function walk(dir, ext, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, ext, out);
    else if (ext.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Comments explain history and decisions; the rule is about what the code does and says. Block
 * and line comments become blank (newlines kept, so line numbers stay true). Quote-aware enough
 * for this codebase: a `//` inside a string or a URL is left alone.
 */
function stripComments(source, html) {
  if (html) return source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += next ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const block = source.slice(i, end === -1 ? source.length : end + 2);
      out += block.replace(/[^\n]/g, ' ');
      i += block.length;
      continue;
    }
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** The first folder under the app: the module a finding is charged to. */
const moduleOf = (area, rel) => `${area}/${rel.split('/').slice(0, rel.startsWith('features/') ? 2 : 1).join('/')}`;

const counts = {};
const details = [];
const bump = (key, where) => {
  counts[key] = (counts[key] ?? 0) + 1;
  details.push(`${key}  ${where}`);
};

for (const { area, dir, ext } of SOURCES) {
  for (const file of walk(dir, ext)) {
    const rel = relative(dir, file).replace(/\\/g, '/');
    const path = `/${rel}`;
    if (IGNORED_PATHS.some((rx) => rx.test(path))) continue;
    if (COUNTRY_SCOPED_PATHS.some((rx) => rx.test(path))) continue;
    const lines = stripComments(readFileSync(file, 'utf8'), file.endsWith('.html')).split('\n');
    lines.forEach((code, index) => {
      if (!code.trim()) return;
      // A row of a table keyed by country (`CO: { regime: 'DIAN' }`) is per-country DATA, which is
      // the sanctioned shape; and a line naming several markets' terms is an enumeration of all of
      // them (`'Tax ID (RNC, RFC, EIN…)'`), which ties the code to none.
      if (COUNTRY_ROW.test(code)) return;
      const named = Object.entries(termRegex).filter(([, rx]) => rx.test(code)).map(([country]) => country);
      if (named.length === 1) bump(`${moduleOf(area, rel)}|${named[0]}|term`, `${area}/${rel}:${index + 1}`);
      const branch = BRANCH.exec(code);
      if (branch) bump(`${moduleOf(area, rel)}|${branch[1] ?? branch[2] ?? branch[3]}|branch`, `${area}/${rel}:${index + 1}`);
    });
  }
}

for (const file of readdirSync(LOCALES).filter((f) => f.endsWith('.json'))) {
  const catalogue = JSON.parse(readFileSync(join(LOCALES, file), 'utf8'));
  for (const [key, value] of Object.entries(catalogue)) {
    if (key.startsWith('$') || typeof value !== 'object' || COUNTRY_SCOPED_KEY.test(key)) continue;
    const text = Object.values(value).join(' ');
    for (const [country, rx] of Object.entries(termRegex)) {
      if (rx.test(text)) bump(`locales/${file.replace('.json', '')}|${country}|wording`, key);
    }
  }
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).counts ?? {} : {};
const baseTotal = Object.values(baseline).reduce((a, b) => a + b, 0);
const worse = Object.entries(counts).filter(([key, n]) => n > (baseline[key] ?? 0));
const better = Object.entries(baseline).filter(([key, n]) => (counts[key] ?? 0) < n);

const byCountry = {};
for (const [key, n] of Object.entries(counts)) {
  const [, country, kind] = key.split('|');
  byCountry[`${country} ${kind}`] = (byCountry[`${country} ${kind}`] ?? 0) + n;
}
console.log('── Neutralidad por país ──');
for (const [k, n] of Object.entries(byCountry).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);
console.log(`  ${String(total).padStart(5)}  TOTAL   (baseline: ${baseTotal})`);

if (args.has('--report')) for (const line of details.sort()) console.log(line);

if (args.has('--update')) {
  if (worse.length && !args.has('--force')) {
    console.error(`\n✗ ${worse.length} cuenta(s) subieron; el baseline no se reescribe sin --force.`);
    process.exit(1);
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ $note: 'Country-specific vocabulary and branches outside the places they belong. Only goes down. See country-neutrality.config.mjs.', counts: Object.fromEntries(Object.entries(counts).sort()) }, null, 2)}\n`);
  console.log(`\n✓ Baseline actualizado: ${baseTotal} → ${total}`);
  process.exit(0);
}

if (worse.length) {
  console.error(`\n✗ ${worse.length} cuenta(s) empeoraron respecto al baseline:`);
  for (const [key, n] of worse) {
    console.error(`   ${key}   ${baseline[key] ?? 0} → ${n}`);
    for (const line of details.filter((d) => d.startsWith(`${key}  `)).slice(0, 8)) console.error(`       ${line.split('  ')[1]}`);
  }
  console.error('\n  Lo de un país vive en su adaptador de régimen o en datos; el núcleo no nombra países.');
  process.exit(1);
}
if (better.length) console.log(`\n✓ ${better.length} cuenta(s) bajaron. Fija el avance con: npm run verify:country-neutrality -- --update`);
else console.log('\n✓ Sin retrocesos.');
