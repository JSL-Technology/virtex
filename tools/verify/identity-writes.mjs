#!/usr/bin/env node
/**
 * Fails the build when a `User` is persisted with a plain `save` instead of the identity writers.
 *
 * ## Why this exists
 *
 * `users` is global — one identity serves every tenant a person works for — and the person's roles
 * in ALL of those tenants hang off the same `User.roles` relation. Administration reads load that
 * relation filtered to the tenant being administered, which is correct. Saving it is not: for a
 * `ManyToMany`, TypeORM reloads every id in the relation and deletes from `user_roles` whatever
 * is missing from the in-memory array. A `save` on a tenant-filtered user therefore deleted the
 * person's roles in every OTHER tenant — including when they merely changed their own avatar.
 *
 * `users/persistence/identity-writes.ts` holds the two correct ways to write an identity:
 * `saveIdentity` (attributes, never roles) and `replaceRolesInOrganization` (roles, one tenant).
 * This check keeps every other file on them.
 *
 * ## What it flags
 *
 * `userRepository.save(`, `manager.save(User`, and `manager.save(<variable>)` where the variable
 * is conventionally a user (`user`, `newUser`, `existingUser`). A genuinely new
 * identity — one that has no roles in any other tenant yet — may be saved whole: annotate it with
 * `identity-writes-allow` and say why.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SCAN_DIR = join(ROOT, 'apps', 'backend', 'api', 'src', 'app');
const ALLOW = 'identity-writes-allow';
const WRITER = join('users', 'persistence', 'identity-writes.ts');

const PATTERNS = [
  { pattern: /\buserRepository\.save\(/, what: 'saves through the User repository' },
  { pattern: /\.save\(\s*User\s*,/, what: 'saves a User entity through a manager' },
  {
    pattern: /\b(?:manager|queryRunner\.manager|em)\.save\(\s*(?:user|newUser|existingUser)\s*\)/,
    what: 'saves a user-shaped variable through a manager',
  },
];

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

function stripComments(source) {
  const out = [];
  let inBlock = false;
  for (const line of source.split('\n')) {
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
  if (rel.endsWith(WRITER)) continue;
  // The seeders build fixed fixtures before any tenant exists.
  if (rel.includes(join('database', 'seeders')) || rel.includes(join('database', 'migrations'))) continue;
  const source = readFileSync(file, 'utf8');
  const raw = source.split('\n');
  stripComments(source).forEach((code, index) => {
    const match = PATTERNS.find(({ pattern }) => pattern.test(code));
    if (!match) return;
    const context = raw.slice(Math.max(0, index - 6), index + 1).join('\n');
    if (context.includes(ALLOW)) return;
    violations.push({ file: rel, line: index + 1, what: match.what, code: code.trim() });
  });
}

if (violations.length) {
  console.error(`\n✗ identity-writes: ${violations.length} place(s) persist a User outside the identity writers.\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.what}`);
    console.error(`    ${v.code}`);
  }
  console.error(
    '\n  Use saveIdentity(manager, user) for the identity\'s own attributes and\n' +
      '  replaceRolesInOrganization(manager, userId, organizationId, roleIds) for its roles in one\n' +
      '  tenant (users/persistence/identity-writes.ts). A plain save of a user whose roles were\n' +
      '  loaded for one tenant deletes their roles in every other. A brand-new identity may be\n' +
      `  saved whole: annotate it with \`${ALLOW}\` and say why.\n`,
  );
  process.exit(1);
}
console.log('✓ identity-writes: every User write goes through the identity writers.');
