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

/** A bare `.find()`/`.findAndCount()` — empty parens or a lone `{}`. */
const BARE_FIND = /\.(find|findAndCount|findAndCountAll)\(\s*(\{\s*\})?\s*\)/;
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
    if (!BARE_FIND.test(line)) return;
    // The allow marker lives in a comment, so look for it in the RAW lines: the current line and
    // the two above (an explanatory annotation may span a line or two).
    const window = [raw[index], raw[index - 1], raw[index - 2]].filter(Boolean);
    if (window.some((text) => text.includes(ALLOW))) return;
    violations.push({ file: relative(ROOT, file), line: index + 1, text: raw[index].trim() });
  });
}

if (violations.length > 0) {
  console.error(
    `\n✗ tenant-scope-guard: ${violations.length} unscoped repository read(s) found.\n` +
      `  A '.find()'/'.findAndCount()' with no filter returns EVERY tenant's rows. Add a\n` +
      `  'where: { organizationId }', or — if the table is genuinely global — annotate the line\n` +
      `  with 'tenant-scope-guard-allow' and say why.\n`,
  );
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.text}`);
  }
  console.error('');
  process.exit(1);
}

console.log('✓ tenant-scope-guard: no unscoped repository reads.');
