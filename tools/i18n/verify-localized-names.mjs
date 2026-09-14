#!/usr/bin/env node
/**
 * An account's name, printed without being translated.
 *
 * `accounts.name` and `accounts.description` are the only two columns in the schema stored as a
 * translation map — `{ es: 'Inventarios', en: 'Inventory' }` — because one tenant keeps one chart
 * of accounts for two audiences. A template that prints that value directly renders the string
 * `[object Object]`, and nothing catches it: it is not a type error (interpolation accepts any
 * value and calls `toString`), not a compile error, and not a failed render. The screen simply
 * says `[object Object]` where an account name belongs.
 *
 * That is exactly what happened. `VxLocalizedNamePipe` was written for this, shipped inside
 * `FORMAT_PIPES`, and adopted in the chart-of-accounts list and the merge tool — while the manual
 * journal entry form, the audit adjustment form and the account form kept printing the raw object.
 * The journal entry form is the screen an accountant uses to post an entry by hand, and every one
 * of its 55 account options read `[object Object]`, so the entry could not be posted at all. A
 * fourth screen had solved it privately, with its own copy of the fallback chain, which is how the
 * two paths drifted apart in the first place.
 *
 * So this turns that class of defect into a build failure. It reads every component that consumes
 * the account model and checks the template it renders: any interpolation of `.name` or
 * `.description` must pass through `| vxName`, or be listed in `localized-names-allowed.json` with
 * a reason — the bank-account screens are the honest exception, since `bank_accounts.name` is a
 * plain string column.
 *
 *     node tools/i18n/verify-localized-names.mjs           # non-zero exit on any finding
 *     node tools/i18n/verify-localized-names.mjs --list    # every finding, with file and line
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const APPS = ['apps/core/client-web/src', 'apps/pos/src', 'apps/desktop/src'];
const ALLOWLIST_PATH = join(ROOT, 'tools/i18n/localized-names-allowed.json');

/** A component that imports one of these is handling chart-of-accounts rows. */
const ACCOUNT_SOURCES = [
  'models/account.model',
  'chart-of-accounts.service',
  'chart-of-accounts.state',
];

/** Bank accounts are a different table with a plain `name` column; never confuse the two. */
const NOT_ACCOUNT_SOURCES = ['bank-accounts.service', 'bank-account.model'];

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const allowlist = existsSync(ALLOWLIST_PATH)
  ? JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'))
  : { allowed: [] };
const allowed = new Set((allowlist.allowed ?? []).map((e) => `${e.file}:${e.line}`));

/**
 * `{{ x.name }}` and `{{ ... name: x.name ... }}`, but not when a pipe follows the member access.
 * The negative lookahead stops at `|` so `{{ a.name | vxName }}` is accepted and
 * `{{ a.name }}` is not.
 */
const UNGUARDED = /\b[A-Za-z_$][\w$]*\s*(?:\(\s*\))?\??\.\s*(name|description)\s*(?![\w$])(?!\s*\|)/g;

const findings = [];

for (const app of APPS) {
  const base = join(ROOT, app);
  for (const file of walk(base)) {
    if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;
    const source = readFileSync(file, 'utf8');
    const usesAccounts = ACCOUNT_SOURCES.some((s) => source.includes(s));
    if (!usesAccounts) continue;
    const onlyBankAccounts =
      NOT_ACCOUNT_SOURCES.some((s) => source.includes(s)) &&
      !source.includes('models/account.model');
    if (onlyBankAccounts) continue;

    // The template this component renders: an external file, or an inline `template:`.
    const templates = [];
    const external = source.match(/templateUrl:\s*['"]([^'"]+)['"]/);
    if (external) {
      const path = resolve(dirname(file), external[1]);
      if (existsSync(path)) templates.push([path, readFileSync(path, 'utf8')]);
    }
    const inline = source.match(/template:\s*`([\s\S]*?)`/);
    if (inline) templates.push([file, inline[1]]);

    for (const [path, text] of templates) {
      const rel = path.replace(`${ROOT}/`, '');
      text.split('\n').forEach((line, index) => {
        // Only interpolations and bindings can render to the screen.
        if (!line.includes('{{') && !line.includes('[') ) return;
        for (const match of line.matchAll(UNGUARDED)) {
          const expression = match[0];
          // `file.name`, `plan.name`, `role.name` and friends are plain strings; the identifier
          // has to look like an account for this to be the defect we are hunting.
          if (!/^(account|acc|opt|parent|control|child|row|node|a)\b/i.test(expression)) continue;
          const key = `${rel}:${index + 1}`;
          if (allowed.has(key)) continue;
          findings.push({ file: rel, line: index + 1, expression: expression.trim(), text: line.trim() });
        }
      });
    }
  }
}

const list = process.argv.includes('--list');
if (findings.length === 0) {
  console.log('localized names: every account name and description passes through | vxName');
  process.exit(0);
}

console.error(`localized names: ${findings.length} account value(s) rendered without | vxName\n`);
for (const f of list ? findings : findings.slice(0, 20)) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.text.slice(0, 140)}`);
}
if (!list && findings.length > 20) console.error(`  …and ${findings.length - 20} more (--list for all)`);
console.error('\nFix: add `| vxName` (the pipe ships in FORMAT_PIPES), or record the line in');
console.error('tools/i18n/localized-names-allowed.json with the reason it is a plain string.');
process.exit(1);
