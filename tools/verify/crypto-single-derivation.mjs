#!/usr/bin/env node
/**
 * Fails the build when a second implementation of "encrypt data at rest" appears.
 *
 * ## Why a checker and not a comment
 *
 * There were four derivations of a key from `ENCRYPTION_SECRET`, in four files, with three
 * different serialisations between them:
 *
 *   - `CryptoUtil`                    — `iv:tag:ct`, 12-byte IV   (TOTP secrets)
 *   - `TokenService.encryptIp`        — `iv:ct:tag`, 16-byte IV   (refresh_tokens.encrypted_ip)
 *   - `SecretEncryptionService`       — `iv:ct:tag`, 12-byte IV   (IdP client secrets)
 *   - `encrypted-column.transformer`  — its own sealed format      (payroll personal data)
 *
 * The first two both wrote `refresh_tokens.encrypted_ip`: one column, two mutually unreadable
 * formats, and no reader anywhere — so the forensic capability the column exists to provide did
 * not exist, and nobody could have noticed.
 *
 * What makes this worth a build step rather than a fix is the comment that was already in
 * `session.service.ts`:
 *
 *   > L-13 FIX: delegate to the centralized CryptoUtil so all encryption shares one key
 *   > derivation (ENCRYPTION_SECRET + AUTH_SALT). Removes the third, divergent derivation.
 *
 * That was written when one of the four callers was changed. It asserted a property of the whole
 * codebase from inside one file, it was wrong the moment it was written, and it stayed wrong
 * through several audits because a reader who trusts it has no reason to look. Prose cannot hold
 * an invariant; this can.
 *
 * ## What is allowed
 *
 * Exactly the files listed in `SANCTIONED`, each with the reason it is separate. Anything else
 * that derives a key from `ENCRYPTION_SECRET` — or calls `createCipheriv` / `createDecipheriv`
 * outside them — fails.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SCAN_DIR = join(ROOT, 'apps');

/**
 * The implementations that are allowed to exist, and why each one is not merged into the others.
 *
 * Four, and the distinction between them is the point. What this checker bans is several
 * derivations of the SAME secret producing incompatible formats — the bug that left one column
 * written two ways. Deriving from DIFFERENT key material on purpose is the opposite: it means a
 * compromise of the OAuth handshake does not reach the DGII certificates, and neither reaches the
 * TOTP secrets. That is key separation and it is worth keeping.
 *
 * The one genuine exception is the column transformer, which cannot inject anything because the
 * ORM constructs it, and which seals its own versioned shape for payroll data. Merging it would
 * mean rewriting every encrypted payroll column in a migration — real risk, for a property this
 * file can guarantee without it.
 */
const SANCTIONED = new Map([
  [
    join('apps', 'backend', 'api', 'src', 'app', 'shared', 'utils', 'crypto.util.ts'),
    'The single primitive. Everything that can inject it, must.',
  ],
  [
    join('apps', 'backend', 'api', 'src', 'app', 'common', 'database', 'encrypted-column.transformer.ts'),
    'A TypeORM column transformer: built by the ORM, so it cannot inject CryptoUtil. Seals its ' +
      'own versioned shape for payroll personal data and carries its own key rotation.',
  ],
  [
    join('apps', 'backend', 'api', 'src', 'app', 'auth', 'services', 'oauth-state.service.ts'),
    'Different KEY MATERIAL, on purpose: OAUTH_STATE_SECRET, so a compromise of the OAuth ' +
      'handshake cookie does not reach anything else. Key separation is the opposite of the ' +
      'problem this checker exists for — what it bans is several derivations of the SAME secret ' +
      'with incompatible formats.',
  ],
  [
    join('apps', 'backend', 'api', 'src', 'app', 'einvoicing', 'services', 'certificate-vault.service.ts'),
    'Different key material again: ECF_CERT_ENCRYPTION_KEY seals DGII signing certificates, ' +
      'which are legally significant and deliberately kept on their own key.',
  ],
]);

/** Deriving a key from the encryption secret, or reaching for a cipher directly. */
const PATTERNS = [
  { pattern: /scryptSync\s*\(/, what: 'derives a key with scryptSync' },
  { pattern: /pbkdf2Sync\s*\(/, what: 'derives a key with pbkdf2Sync' },
  { pattern: /createCipheriv\s*\(/, what: 'creates a cipher directly' },
  { pattern: /createDecipheriv\s*\(/, what: 'creates a decipher directly' },
];

/**
 * Files that legitimately use these primitives for something that is NOT data-at-rest encryption.
 * Named explicitly rather than pattern-matched, so adding one is a decision somebody makes.
 */
const UNRELATED = new Set([
  // Ephemeral RSA key generation and JWKS export — signing, not encryption at rest.
  join('apps', 'backend', 'api', 'src', 'app', 'auth', 'services', 'key-management.service.ts'),
  join('apps', 'backend', 'api', 'src', 'app', 'extensions', 'services', 'signing-key.provider.ts'),
]);

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
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const violations = [];

for (const file of collect(SCAN_DIR)) {
  const rel = relative(ROOT, file);
  if (SANCTIONED.has(rel) || UNRELATED.has(rel)) continue;

  const code = stripComments(readFileSync(file, 'utf8'));
  for (const { pattern, what } of PATTERNS) {
    if (pattern.test(code)) {
      violations.push({ file: rel, what });
    }
  }
}

if (violations.length) {
  console.error(`\n✗ crypto: ${violations.length} implementation(s) of encryption outside the sanctioned ones.\n`);
  for (const violation of violations) {
    console.error(`  ${violation.file} — ${violation.what}`);
  }
  console.error(
    '\n  Inject CryptoUtil instead. One derivation and one format is what keeps two writers of the\n' +
      '  same column from producing values neither can read — which is exactly what happened to\n' +
      '  refresh_tokens.encrypted_ip. If a new implementation is genuinely unavoidable, add it to\n' +
      '  SANCTIONED in this file with the reason.\n',
  );
  process.exit(1);
}

console.log(
  `✓ crypto: ${SANCTIONED.size} sanctioned implementation(s), no others.`,
);
