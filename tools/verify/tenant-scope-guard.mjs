#!/usr/bin/env node
/**
 * Fails the build on a repository read that omits its tenant scope.
 *
 * ## Why this exists
 *
 * Tenant isolation in this backend is enforced by ~90 services each remembering
 * `where: { organizationId }`. That is a control that must be *remembered*, and the audit that
 * introduced this guard found the one place it had been forgotten: `manufacturing.service.ts`
 * returned its production orders with no filter, handing every tenant's rows to any authenticated
 * caller. The database-level row-level-security policies that would make this impossible are
 * installed but not yet enforcing (they require the `virtex_app` role cutover and a request-scoped
 * manager — a supervised operational change), so until then this static guard is the backstop.
 *
 * ## What it flags
 *
 * A bare `.find()` / `.findAndCount()` / `.findAndCountAll()` — an empty call, or one whose only
 * argument is `{}` — in executable code under the backend source. Those are the shape of the bug:
 * a query over a whole table with no filter. Scoped reads and lookups by id are untouched.
 *
 * Comments are ignored (both `//` line comments and `/* *​/` blocks), so a doc comment that quotes
 * the anti-pattern — like this one — does not trip the guard, and neither does prose describing it.
 *
 * ## Intentional exceptions
 *
 * A read of genuinely global data — currencies, fiscal regions, units of measure — or a
 * cross-tenant maintenance job is annotated with `tenant-scope-guard-allow` on the same line or one
 * of the two lines above it. The annotation is the audit trail: it forces the author to justify an
 * unscoped read rather than the guard guessing from a filename allowlist that drifts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SCAN_DIR = join(ROOT, 'apps', 'backend', 'api', 'src', 'app');

/**
 * The shapes that read a tenant table without naming the tenant.
 *
 * ## Why there are three and not one
 *
 * There used to be one: a bare `.find()` with empty parens. Its own documentation conceded the
 * gap — "Scoped reads and lookups by id are untouched" — and that concession is the finding. A
 * lookup by id with no tenant filter is not a separate, milder case: it is the textbook
 * insecure-direct-object-reference, the exact bug where changing a UUID in a URL reaches another
 * customer's invoice. Treating it as out of scope meant the guard could only ever catch the least
 * likely mistake.
 *
 * So the guard now recognises:
 *
 *  1. BARE_FIND        — `.find()`, `.findAndCount()`, or one whose only argument is `{}`.
 *  2. UNSCOPED_BY_ID   — `findOne`/`findOneBy`/`findOneOrFail` whose `where` names `id` and
 *                        nothing else. This is the IDOR shape.
 *  3. BARE_QUERY_BUILDER — a `createQueryBuilder(...)` chain that never mentions the tenant.
 *
 * Each is matched over a WINDOW of lines rather than one line, because these calls are routinely
 * written across several — a single-line regex would have missed most of the real code.
 *
 * Legitimate exceptions stay legitimate and stay visible: a read of genuinely global data, or one
 * that authenticates before a tenant exists, carries `tenant-scope-guard-allow` with a reason.
 * There are four such reads on the authentication path and they are annotated, not special-cased,
 * which is what keeps the list reviewable.
 */
const BARE_FIND = /\.(find|findAndCount|findAndCountAll)\(\s*(\{\s*\})?\s*\)/;

/** `findOne({ where: { id } })` / `findOneBy({ id })` and friends, with no second criterion. */
const UNSCOPED_BY_ID =
  /\.(findOne|findOneOrFail)\(\s*\{\s*where:\s*\{\s*id\s*(:\s*[A-Za-z0-9_.[\]'"]+\s*)?\}/;
const UNSCOPED_BY_ID_SHORTHAND =
  /\.(findOneBy|findOneByOrFail)\(\s*\{\s*id\s*(:\s*[A-Za-z0-9_.[\]'"]+\s*)?\}/;

/** The line a single-row lookup starts on. The window after it decides whether it is scoped. */
const FINDS_ONE = /\.(findOne|findOneBy|findOneOrFail|findOneByOrFail)\(/;

/** The start of a query-builder chain; the window decides whether the tenant ever appears. */
const QUERY_BUILDER = /\.createQueryBuilder\(/;

/**
 * How many lines after a match count as the same call.
 *
 * Generous on purpose. A query-builder chain in this codebase routinely runs past thirty lines —
 * a `select([...])` of twelve columns before the `where` is ordinary — and a short window reports
 * those as unscoped when the filter is simply further down. A window that cries wolf is a check
 * people start passing with an annotation instead of a fix.
 */
const WINDOW = 40;

/** Anything that names the tenant counts as scoping, in whichever spelling the call uses. */
const MENTIONS_TENANT = /organizationId|organization_id|parentOrganizationId|parent_organization_id|tenant/i;

const ALLOW = 'tenant-scope-guard-allow';

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip comments from a source file, line by line, so the matcher only ever sees code.
 *
 * Returns, per line, the code with comments blanked out. Block-comment state carries across lines.
 * String literals are not parsed — a `.find()` inside a quoted string is vanishingly rare and a
 * false positive there is a cheap price for not shipping a regex JS tokenizer.
 */
function stripComments(source) {
  const lines = source.split('\n');
  const codeLines = [];
  let inBlock = false;

  for (const line of lines) {
    let code = '';
    for (let i = 0; i < line.length; i++) {
      const pair = line[i] + (line[i + 1] ?? '');
      if (inBlock) {
        if (pair === '*/') {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (pair === '/*') {
        inBlock = true;
        i++;
        continue;
      }
      if (pair === '//') break; // rest of the line is a comment
      code += line[i];
    }
    codeLines.push(code);
  }
  return codeLines;
}

const violations = [];

for (const file of collect(SCAN_DIR)) {
  const raw = readFileSync(file, 'utf8').split('\n');
  const code = stripComments(readFileSync(file, 'utf8'));

  code.forEach((line, index) => {
    // The call as written, which may run over several lines.
    const forward = code.slice(index, index + WINDOW).join(' ');

    let reason = null;
    if (BARE_FIND.test(line)) {
      reason = 'read with no filter at all';
    } else if (FINDS_ONE.test(line)) {
      // Anchored on the line where the CALL STARTS, then read forward. Testing the whole window
      // for every index reported the same call once per line of context — 266 "violations" from a
      // few dozen calls, which is a checker nobody would run twice.
      //
      // `findOne({ where: { id, organizationId } })` is the correct form and names the tenant
      // inside the same call, so it is excluded by the tenant test rather than by a second regex.
      if (
        (UNSCOPED_BY_ID.test(forward) || UNSCOPED_BY_ID_SHORTHAND.test(forward)) &&
        !MENTIONS_TENANT.test(forward)
      ) {
        reason = 'lookup by id with no tenant filter';
      }
    } else if (QUERY_BUILDER.test(line) && !MENTIONS_TENANT.test(forward)) {
      reason = 'query builder that never names the tenant';
    }

    if (!reason) return;

    // The allow marker lives in a comment, so look for it in the RAW lines: the current line and
    // the four above.
    //
    // Four and not two, because the annotation has to carry a REASON and a reason for an unscoped
    // read is rarely one line — "this is the caller's own account, read on the authentication path
    // before a tenant exists" does not fit. A lookback shorter than the explanations people
    // actually write pushes them toward a terse marker, which is the opposite of what the
    // annotation is for.
    const above = [raw[index], raw[index - 1], raw[index - 2], raw[index - 3], raw[index - 4]]
      .filter(Boolean);
    if (above.some((text) => text.includes(ALLOW))) return;

    violations.push({
      file: relative(ROOT, file),
      line: index + 1,
      text: raw[index].trim(),
      reason,
    });
  });
}

if (violations.length > 0) {
  console.error(
    `\n✗ tenant-scope-guard: ${violations.length} unscoped repository read(s) found.\n` +
      `  A read with no tenant filter returns — or reaches — another customer's rows. Add a\n` +
      `  'where: { organizationId }' (or the tenant column this table uses), or — if the table is\n` +
      `  genuinely global, or the read happens before a tenant exists — annotate the line with\n` +
      `  'tenant-scope-guard-allow' and say why.\n`,
  );
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  [${violation.reason}]`);
    console.error(`      ${violation.text}`);
  }
  console.error('');
  process.exit(1);
}

console.log('✓ tenant-scope-guard: no unscoped repository reads.');
