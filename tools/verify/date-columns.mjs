#!/usr/bin/env node
/**
 * A calendar date declared as an instant.
 *
 * A `date` column has no time and no zone. An entity that types it `Date` makes TypeORM serialise
 * it as `2026-09-14T00:00:00.000Z`, and the browser then does the only thing it can with an
 * instant: renders it in the reader's zone. In `America/Santo_Domingo` — UTC−4 — midnight on the
 * 14th is 20:00 on the 13th, so the document shows the day before its own date.
 *
 * That is what happened to supplier bills. `vendor_bills.date` and `"dueDate"` were declared
 * `@Column() date: Date`, which reflect-metadata resolves to `timestamp`, and every bill in the
 * product displayed a day early — on the document, in the list, in the ageing buckets and on the
 * DGII 606, where the document date is what the tax authority matches against the supplier's own
 * filing. The sibling column `paid_at` was already `date`, as are the invoice dates, which is why
 * sales documents were wrong only in rendering and purchases were wrong in the data too.
 *
 * So: a column declared `type: 'date'` must be typed `string`, all the way to the client.
 *
 *     node tools/verify/date-columns.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'apps/backend/api/src');
const BASELINE_PATH = resolve(process.cwd(), 'tools/verify/date-columns-baseline.json');

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.entity.ts')) out.push(full);
  }
  return out;
};

/** `@Column(…)` immediately followed by the property it decorates. */
const COLUMN = /@Column\(([\s\S]*?)\)\s*\n\s*(?:readonly\s+)?(\w+)\s*[!?]?\s*:\s*([^;]+);/g;

const wrong = [];
let checked = 0;

for (const file of walk(ROOT)) {
  const source = readFileSync(file, 'utf8');
  const rel = file.replace(`${resolve(process.cwd())}/`, '');

  for (const match of source.matchAll(COLUMN)) {
    const [, args, property, type] = match;
    // `@Column('date')` and `@Column({ type: 'date' })`, not `dateOnly`, not `timestamp`.
    const isDate = /(^|[^\w])'date'/.test(args) || /type:\s*'date'/.test(args);
    if (!isDate) continue;
    checked++;

    const declared = type.trim();
    if (/\bDate\b/.test(declared)) {
      wrong.push({
        rel,
        line: source.slice(0, match.index).split('\n').length,
        property,
        declared,
      });
    }
  }
}

/**
 * A ratchet, not a cliff.
 *
 * Eighteen entities already declare a `date` column as `Date`. Those are an annotation that is not
 * true — `pg` returns a `date` as a string, so the property holds `'2026-09-14'` whatever the type
 * says — but they are NOT the defect this guards: because the column really is `date`, the value
 * reaches the client as a calendar date and renders correctly. Making all eighteen honest produces
 * twenty-five compile errors across period closing, year-end close and exchange rates, each needing
 * its own reading; doing that blind, to fix nothing a user can see, is how a correct ledger gets
 * broken.
 *
 * So they are recorded, and this fails on the nineteenth. What it actually catches is the case that
 * did bite: a `Date` property whose column is therefore built as `timestamp`, which is how supplier
 * bills came to show the day before their own date.
 */
const baseline = existsSync(BASELINE_PATH)
  ? new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).known ?? [])
  : new Set();

const fresh = wrong.filter((entry) => !baseline.has(`${entry.rel}:${entry.property}`));
const carried = wrong.length - fresh.length;

if (fresh.length === 0) {
  console.log(
    `date columns: ${checked} calendar date column(s) checked; ` +
      `${carried} known annotation(s) carried, no new one`,
  );
  process.exit(0);
}

console.error(`date columns: ${fresh.length} NEW column(s) typed as an instant\n`);
for (const entry of fresh) {
  console.error(`  ${entry.rel}:${entry.line}  ${entry.property}: ${entry.declared}`);
  console.error(`    a 'date' column carries no time; type it \`string\` so it stays a calendar date\n`);
}
console.error('If the column really is an instant, declare it `timestamptz`, not `date`.');
process.exit(1);
