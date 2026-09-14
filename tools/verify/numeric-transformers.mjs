#!/usr/bin/env node
/**
 * A `NOT NULL` money column that inserts `NULL`.
 *
 * `numericTransformer` exists because `pg` returns every `numeric` as a string. Its `to()` maps
 * `undefined` to `null`, which is right for a nullable column and wrong for one the schema
 * declares `NOT NULL`: TypeORM then writes an explicit `NULL` instead of omitting the column, so
 * the database default never applies and the insert fails the constraint.
 *
 * That is not theoretical. `pos_shifts.salesTotal` is `numeric(14,2) NOT NULL DEFAULT 0` and the
 * entity used the nullable transformer, so opening a till session — which never sets a sales total,
 * because the till has sold nothing yet — raised
 *
 *     null value in column "salesTotal" of relation "pos_shifts" violates not-null constraint
 *
 * on every single attempt. The point of sale could not open a shift, and therefore could not sell,
 * for as long as that entity has existed. Five columns across the two POS entities were written
 * this way.
 *
 * `numericTransformerNotNull` is the counterpart: `undefined` becomes `0`. This checks that the two
 * are never swapped — a nullable column keeps the nullable transformer, and a `NOT NULL` one gets
 * the other.
 *
 *     node tools/verify/numeric-transformers.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'apps/backend/api/src');

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.entity.ts')) out.push(full);
  }
  return out;
};

/** `@Column({ … })` immediately followed by the property it decorates. */
const COLUMN = /@Column\(\{([\s\S]*?)\}\)\s*\n\s*(?:readonly\s+)?(\w+)\s*[!?]?\s*:\s*([^;]+);/g;

const wrong = [];
let checked = 0;

for (const file of walk(ROOT)) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('numericTransformer')) continue;
  const rel = file.replace(`${resolve(process.cwd())}/`, '');

  for (const match of source.matchAll(COLUMN)) {
    const [, body, property, type] = match;
    const nullableTransformer = /transformer:\s*numericTransformer\b(?!NotNull)/.test(body);
    const notNullTransformer = /transformer:\s*numericTransformerNotNull\b/.test(body);
    if (!nullableTransformer && !notNullTransformer) continue;
    checked++;

    const declaredNullable = /nullable:\s*true/.test(body) || /\|\s*null/.test(type);
    const line = source.slice(0, match.index).split('\n').length;

    if (nullableTransformer && !declaredNullable) {
      wrong.push({
        rel,
        line,
        property,
        problem: 'NOT NULL column uses numericTransformer — an unset value inserts NULL',
        fix: 'numericTransformerNotNull',
      });
    }
    if (notNullTransformer && declaredNullable) {
      wrong.push({
        rel,
        line,
        property,
        problem: 'nullable column uses numericTransformerNotNull — NULL is silently stored as 0',
        fix: 'numericTransformer',
      });
    }
  }
}

if (wrong.length === 0) {
  console.log(`numeric transformers: ${checked} column(s), every one matched to its nullability`);
  process.exit(0);
}

console.error(`numeric transformers: ${wrong.length} of ${checked} column(s) use the wrong one\n`);
for (const entry of wrong) {
  console.error(`  ${entry.rel}:${entry.line}  ${entry.property}`);
  console.error(`    ${entry.problem}`);
  console.error(`    use: ${entry.fix}\n`);
}
process.exit(1);
