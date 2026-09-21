#!/usr/bin/env node
/**
 * Fails the build when a security decision is made by reading `NODE_ENV` directly.
 *
 * ## Why this exists
 *
 * `auth.config.ts` opens by stating the project's rule, and states it because the opposite rule
 * had already shipped:
 *
 *   > The previous implementation gated every fail-fast check on `NODE_ENV === 'production'`.
 *   > That left a hole: any other value — `staging`, `prod`, `qa`, or simply an unset variable —
 *   > silently fell through to a hardcoded development secret. […] The rule is now inverted and
 *   > allow-list based.
 *
 * The rule was right and it did not reach every caller. A security audit found five different
 * shapes coexisting: `isDevLikeEnvironment()` (correct), `!== 'production'` (the dev seeder and
 * Swagger), `=== 'production'` (plugin admission, the signing-key provider, TokenService),
 * `=== 'test'` (the sandbox's signature check) and `?? 'development'`. Between them they meant a
 * deployment that had not spelled NODE_ENV exactly right seeded an administrator with a password
 * from this repository, published its API surface, skipped SAST and accepted a literal string in
 * place of an RSA signature.
 *
 * The reason all five existed is that the rule lived in a comment. A comment cannot fail a build.
 * This can.
 *
 * ## What counts as a violation
 *
 * A comparison of `NODE_ENV` against a string literal, or a defaulting read of it, in executable
 * code under `apps/` and `tools/`. Reading it to decide something that is NOT a security control
 * — a log level, a pretty-printer — is common and harmless, so those sites carry
 * `env-gating-allow` on the same line or one of the two above, which is the audit trail: it makes
 * the author write down why this one is not a gate.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SCAN_DIRS = [join(ROOT, 'apps'), join(ROOT, 'tools')];
const ALLOW = 'env-gating-allow';

/** The file that DEFINES the allow-list is allowed to read the variable. */
const DEFINITIONS = [
  join('apps', 'backend', 'api', 'src', 'app', 'auth', 'auth.config.ts'),
  join('apps', 'backend', 'api', 'src', 'app', 'config', 'env.validation.ts'),
  // This checker names the patterns it looks for, in strings.
  join('tools', 'verify', 'env-gating.mjs'),
];

/**
 * A comparison against a literal (`NODE_ENV === 'production'`, `!== "test"`), or a defaulting read
 * (`NODE_ENV ?? 'development'`, `NODE_ENV || 'development'`). Both are decisions about which
 * environment this is; both are the thing that must go through one function.
 */
const PATTERNS = [
  /NODE_ENV['\]]*\s*[=!]==?\s*['"]/,
  /['"]\w+['"]\s*[=!]==?\s*(process\.env(\.|\[['"])NODE_ENV)/,
  /NODE_ENV['\]]*\s*(\?\?|\|\|)\s*['"]/,
];

function collect(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.nx') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full));
    } else if (/\.(ts|mjs|js)$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Blank out comments so prose describing the anti-pattern — like this file — does not trip it. */
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
      if (pair === '//') break;
      code += line[i];
    }
    codeLines.push(code);
  }
  return codeLines;
}

const violations = [];

for (const dir of SCAN_DIRS) {
  for (const file of collect(dir)) {
    const rel = relative(ROOT, file);
    if (DEFINITIONS.includes(rel)) continue;

    const source = readFileSync(file, 'utf8');
    // Spec files legitimately construct environments to assert the rule itself.
    if (/\.spec\.ts$/.test(file)) continue;

    const rawLines = source.split('\n');
    const codeLines = stripComments(source);

    codeLines.forEach((code, index) => {
      if (!PATTERNS.some((pattern) => pattern.test(code))) return;

      // The annotation may sit on the line itself or on either of the two above it.
      const context = [rawLines[index - 2], rawLines[index - 1], rawLines[index]]
        .filter(Boolean)
        .join('\n');
      if (context.includes(ALLOW)) return;

      violations.push({ file: rel, line: index + 1, code: code.trim() });
    });
  }
}

if (violations.length) {
  console.error(
    `\n✗ env-gating: ${violations.length} place(s) decide something from NODE_ENV directly.\n`,
  );
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}`);
    console.error(`    ${violation.code}`);
  }
  console.error(
    '\n  Use isDevLikeEnvironment() from auth.config.ts — the project\'s allow-list — so that an\n' +
      '  unset or misspelled NODE_ENV is treated as a real deployment rather than as development.\n' +
      `  If this really is not a security gate (a log level, a pretty-printer), annotate it with\n` +
      `  \`${ALLOW}\` and say why.\n`,
  );
  process.exit(1);
}

console.log('✓ env-gating: every environment decision goes through the allow-list.');
