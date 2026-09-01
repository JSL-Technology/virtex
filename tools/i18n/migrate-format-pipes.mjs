#!/usr/bin/env node
/**
 * Moves the templates off Angular's locale pipes and onto the reactive ones.
 *
 * `| date`, `| number`, `| currency` and `| percent` read `LOCALE_ID`, which this application
 * never provided — so all 106 usages rendered as `en-US` whatever language was selected: `1,234.56`
 * and `Jan 5, 2026` to a reader in Bogotá. `LOCALE_ID` is also fixed at bootstrap and carries no
 * timezone, so it could not have followed the language switch even if it had been set.
 *
 *   node tools/i18n/migrate-format-pipes.mjs --dry
 *   node tools/i18n/migrate-format-pipes.mjs
 *
 * The `vx*` pipes take the same digit grammar (`'1.2-2'`), so a `| number: '1.2-2'` is a rename.
 * `| date` needs a decision — a format string becomes a named preset — and the mapping below is
 * the one place that decision is recorded.
 *
 * A `| currency` is NOT rewritten mechanically. Angular's pipe defaults to USD when no code is
 * given, and guessing which record's currency belongs at a given call site is exactly the kind of
 * guess that puts a dollar sign in front of pesos. Those are reported.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'apps/core/client-web/src/app';
const DRY = process.argv.includes('--dry');

/**
 * Angular date format → named preset.
 *
 * A named preset resolves through CLDR, so `'date'` is `05/01/2026` in Santo Domingo and
 * `1/5/2026` in Miami without anybody writing either — which is the whole point: `'dd/MM/yyyy'`
 * hard-coded in a template is a decision a reader in Miami never agreed to.
 */
const DATE_PRESETS = new Map([
  ["'shortDate'", 'date'],
  ["'mediumDate'", 'dateLong'],
  ["'longDate'", 'dateLong'],
  ["'fullDate'", 'weekday'],
  ["'short'", 'dateTime'],
  ["'medium'", 'dateTimeLong'],
  ["'long'", 'dateTimeLong'],
  ["'shortTime'", 'time'],
  ["'dd/MM/yyyy'", 'date'],
  ["'dd/MM/yy'", 'date'],
  ["'MM/dd/yyyy'", 'date'],
  ["'yyyy-MM-dd'", 'date'],
  ["'dd MMM yyyy'", 'dateLong'],
  ["'d MMM yyyy'", 'dateLong'],
  ["'dd/MM/yyyy HH:mm'", 'dateTime'],
  ["'dd/MM/yyyy, HH:mm'", 'dateTime'],
  ["'MMMM yyyy'", 'monthYear'],
  ["'MMM yyyy'", 'monthYear'],
  ["'dd MMM'", 'dayMonth'],
  ["'d MMM'", 'dayMonth'],
  ["'EEEE, d MMMM yyyy'", 'weekday'],
  ["'EEEE, d MMMM y'", 'weekday'],
  ["'d MMM y, HH:mm'", 'dateTime'],
  ["'HH:mm'", 'time'],
]);

function templates(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return templates(full);
    return full.endsWith('.html') ? [full] : [];
  });
}

const report = { number: 0, percent: 0, date: 0, currency: [], unknownDate: [] };

for (const file of templates(ROOT)) {
  const original = readFileSync(file, 'utf8');
  let source = original;

  // `| number` and `| percent`: same grammar, so the argument travels unchanged.
  source = source.replace(/\|\s*number(\s*:\s*'[^']*')?/g, (whole, arg) => {
    report.number++;
    return `| vxNumber${arg ?? ''}`;
  });
  source = source.replace(/\|\s*percent(\s*:\s*'[^']*')?/g, (whole, arg) => {
    report.percent++;
    return `| vxPercent${arg ?? ''}`;
  });

  // `| date`: the format string becomes a named preset.
  source = source.replace(/\|\s*date(\s*:\s*('[^']*'))?/g, (whole, _arg, format) => {
    if (!format) {
      report.date++;
      return `| vxDate`;
    }
    const preset = DATE_PRESETS.get(format);
    if (!preset) {
      report.unknownDate.push({ file, format });
      return whole;
    }
    report.date++;
    return `| vxDate: '${preset}'`;
  });

  for (const match of source.matchAll(/\|\s*currency[^}|]*/g)) {
    report.currency.push({ file, usage: match[0].trim().slice(0, 60) });
  }

  if (source !== original && !DRY) writeFileSync(file, source);
}

console.log(`| number  -> | vxNumber   ${report.number}`);
console.log(`| percent -> | vxPercent  ${report.percent}`);
console.log(`| date    -> | vxDate     ${report.date}`);
console.log(`unrecognised date formats  ${report.unknownDate.length}`);
for (const item of report.unknownDate) {
  console.log(`  ${relative(ROOT, item.file)}: ${item.format}`);
}
console.log(`| currency, for a person    ${report.currency.length}`);
for (const item of report.currency) {
  console.log(`  ${relative(ROOT, item.file)}: ${item.usage}`);
}
