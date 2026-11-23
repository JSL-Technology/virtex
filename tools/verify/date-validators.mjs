#!/usr/bin/env node
/**
 * A day that does not exist is refused at the door, never by the database.
 *
 * `@IsDateString()` checks the SHAPE of an ISO 8601 date, not that the day exists: «2026-02-30»
 * passes, reaches a `date` column and comes back as a 500 (`date/time field value out of range`).
 * That is how registering a fixed asset bought on the 30th of February failed (audit 2026-11-07,
 * FINB-14), through a bare `@Matches(/^\d{4}-\d{2}-\d{2}$/)` — and how 122 other date fields in the
 * API could have failed the same way.
 *
 * So, in the API: every `IsDateString` is `{ strict: true }`, which refuses a day the calendar does
 * not have; and no `@Matches` validates a date by its shape — a calendar date is `@IsIsoDate()`.
 *
 *     node tools/verify/date-validators.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(process.cwd(), 'apps/backend/api/src/app');
const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) out.push(full);
  }
  return out;
};

const failures = [];
let checked = 0;
for (const file of walk(ROOT)) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const at = (node) => `${relative(process.cwd(), file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (name === 'IsDateString') {
        checked++;
        const [options] = node.arguments;
        const strict =
          options &&
          ts.isObjectLiteralExpression(options) &&
          options.properties.some(
            (property) =>
              ts.isPropertyAssignment(property) &&
              property.name.getText(source) === 'strict' &&
              property.initializer.kind === ts.SyntaxKind.TrueKeyword,
          );
        if (!strict) failures.push(`${at(node)}  IsDateString without { strict: true } accepts «2026-02-30»`);
      }
      if (name === 'Matches') {
        const [pattern] = node.arguments;
        const text = pattern ? pattern.getText(source) : '';
        if (/\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(text) || /ISO_DATE\b/.test(text)) {
          failures.push(`${at(node)}  a date validated by its shape: use @IsIsoDate()`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (failures.length > 0) {
  console.error(`✗ ${failures.length} date field(s) would let a day that does not exist reach the database:\n`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`✓ ${checked} IsDateString validators, every one strict; no date validated by a regular expression.`);
