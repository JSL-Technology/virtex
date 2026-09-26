#!/usr/bin/env node
/**
 * Fails the build when something validates an access token without asking whether its session
 * is still alive.
 *
 * ## Why this exists
 *
 * Access tokens are self-contained JWTs, so a signature check says only that the token was issued
 * — never that it still counts. `SessionRegistryService` is what makes revocation real, and its
 * own header explains the gap it closes:
 *
 *   > `logout` and `revokeSession` deliberately do NOT bump `tokenVersion`, because doing so
 *   > would kill every other session the user has. They marked the refresh token row revoked, but
 *   > nothing ever checked that row when validating an access token.
 *
 * `UserIdentityService.resolveFromPayload` consults it on every HTTP request, which is right. The
 * WebSocket gateway did not: it verified the signature, compared `tokenVersion` and joined the
 * tenant room. Since logout does not move `tokenVersion`, a captured token opened a socket AFTER
 * the victim pressed "cerrar sesión", and that socket received the tenant's events until the
 * token expired on its own.
 *
 * The gateway had its own copy of the validation logic, and the copy is what diverged — the same
 * shape of failure `UserIdentityService` was created to end for the two HTTP validators. A third
 * copy will drift too, so the rule is checked rather than described.
 *
 * ## What it checks
 *
 * Any file that verifies a JWT — `jwt.verify`, `jwtService.verify`, or passport's
 * `secretOrKeyProvider` — must also reach `isRevoked`, or delegate to something that does, or
 * carry `session-revocation-allow` with a reason. Tokens that are not sessions (a password-reset
 * token, a step-up token, the OAuth state cookie) are exactly what the annotation is for.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SCAN_DIR = join(ROOT, 'apps', 'backend', 'api', 'src', 'app');
const ALLOW = 'session-revocation-allow';

/** Verifying a JWT that could be a session token. */
const VERIFY_PATTERNS = [
  /\bjwt\.verify\s*\(/,
  /\bjwtService\.verify\s*(<|\()/,
  /\bthis\.jwtService\.verify\s*(<|\()/,
  /secretOrKeyProvider\s*:/,
];

/** Consulting the registry, directly or through something that does. */
const REVOCATION_MARKERS = [
  'isRevoked',
  'sessionRegistry',
  'SessionRegistryService',
  // These delegate to a validator that consults it.
  //
  // Matched on the METHOD and not on the property it is called through: whether a class injects
  // it as `userIdentityService`, `userIdentity` or `identity` is a naming choice, and a checker
  // that depends on that choice reports a hole where there is none — which is how a correctly
  // delegating WebSocket handshake came to be flagged.
  'resolveFromPayload',
  'validateTokenAndGetUser',
  'verifyUserFromToken',
];

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(source) {
  const lines = source.split('\n');
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    let code = '';
    for (let i = 0; i < line.length; i++) {
      const pair = line[i] + (line[i + 1] ?? '');
      if (inBlock) {
        if (pair === '*/') { inBlock = false; i++; }
        continue;
      }
      if (pair === '/*') { inBlock = true; i++; continue; }
      if (pair === '//') break;
      code += line[i];
    }
    out.push(code);
  }
  return out;
}

const violations = [];

for (const file of collect(SCAN_DIR)) {
  const rel = relative(ROOT, file);
  const source = readFileSync(file, 'utf8');
  const codeLines = stripComments(source);
  const code = codeLines.join('\n');

  const verifies = VERIFY_PATTERNS.some((pattern) => pattern.test(code));
  if (!verifies) continue;

  if (REVOCATION_MARKERS.some((marker) => code.includes(marker))) continue;
  if (source.includes(ALLOW)) continue;

  const line = codeLines.findIndex((candidate) =>
    VERIFY_PATTERNS.some((pattern) => pattern.test(candidate)),
  );
  violations.push({ file: rel, line: line + 1 });
}

if (violations.length) {
  console.error(
    `\n✗ session-revocation: ${violations.length} token validator(s) never ask whether the session is alive.\n`,
  );
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}`);
  }
  console.error(
    '\n  A valid signature is not a live session. Consult SessionRegistryService.isRevoked with the\n' +
      '  token\'s `sessionId`, or delegate to UserIdentityService / SessionService, which do.\n' +
      '  Logout and "revoke this device" deliberately leave tokenVersion alone, so the denylist is\n' +
      `  the ONLY signal that stops an already-issued access token. If this token is not a session\n` +
      `  (a password reset, a step-up proof, the OAuth state cookie), annotate it with \`${ALLOW}\`\n` +
      '  and say which kind of token it is.\n',
  );
  process.exit(1);
}

console.log('✓ session-revocation: every session-token validator consults the denylist.');
