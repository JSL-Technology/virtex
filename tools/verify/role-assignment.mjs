#!/usr/bin/env node
/**
 * Fails the build when a role is assigned without passing the delegation check.
 *
 * ## Why this exists
 *
 * The product has one rule about handing out rights: nobody delegates a permission they do not
 * hold themselves. `RolesService.assertCanAssignRole` implements it, and it is a good
 * implementation — it refuses `'*'` to a non-super-admin and, since the platform tier landed, any
 * `platform:` permission to anybody.
 *
 * It was applied in two of the three places a role is actually assigned. The comment in
 * `users.service.ts` even said so:
 *
 *   > This check was missing here and in `addExistingUserToOrganization`, which were the only
 *   > other two places a role is assigned.
 *
 * They were not the only two. `IdentityProvider.defaultRoleId` decides the role that every user
 * JIT-provisioned through enterprise SSO is created with, it was taken straight from the request
 * body, and it sat behind `settings:edit_company` — a configuration permission that implies
 * nothing about managing people. Pointing it at the ADMINISTRATOR role made every new account
 * from a verified email domain a super-admin.
 *
 * The rule was right. The inventory of places it applied was a sentence in a comment, and a
 * sentence cannot notice a fourth place being added next year.
 *
 * ## What it checks
 *
 * Any service file that writes `user.roles`, or that persists a field whose name ends in
 * `RoleId`, must also mention `assertCanAssignRole` or `assertCanAssignRoleById` — or carry
 * `role-assignment-allow` with a reason.
 *
 * It is deliberately coarse. A precise dataflow analysis would be a different project; what this
 * catches is the case that actually happened, which is a new assignment site written by somebody
 * who did not know the rule existed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SCAN_DIR = join(ROOT, 'apps', 'backend', 'api', 'src', 'app');
const ALLOW = 'role-assignment-allow';

/** Writing the relation, or persisting a pointer to a role. */
const ASSIGNMENT_PATTERNS = [
  { pattern: /\.roles\s*=\s*\[/, what: 'assigns user.roles' },
  { pattern: /\broles:\s*\[\s*role\b/, what: 'creates a user with a role' },
  { pattern: /\b\w*[Rr]oleId\s*=\s*(?!null|undefined)/, what: 'persists a *RoleId' },
  { pattern: /\b\w*[Rr]oleId:\s*dto\./, what: 'persists a *RoleId straight from a DTO' },
];

const GUARDS = ['assertCanAssignRole', 'assertCanAssignRoleById'];

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

  // The file that DEFINES the rule, and the seeding paths that create a tenant's first roles
  // before any actor exists, are exempt by name.
  if (rel.endsWith(join('roles', 'roles.service.ts'))) continue;

  const rawLines = source.split('\n');
  const codeLines = stripComments(source);
  const guarded = GUARDS.some((guard) => source.includes(guard));

  codeLines.forEach((code, index) => {
    const match = ASSIGNMENT_PATTERNS.find(({ pattern }) => pattern.test(code));
    if (!match) return;
    if (guarded) return;

    // The annotation may head a short paragraph of justification, so look back further than one
    // line: a reason worth writing is usually a reason worth more than eighty characters.
    const context = rawLines.slice(Math.max(0, index - 6), index + 1).join('\n');
    if (context.includes(ALLOW)) return;

    violations.push({ file: rel, line: index + 1, what: match.what, code: code.trim() });
  });
}

if (violations.length) {
  console.error(
    `\n✗ role-assignment: ${violations.length} place(s) assign a role without the delegation check.\n`,
  );
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line} — ${violation.what}`);
    console.error(`    ${violation.code}`);
  }
  console.error(
    '\n  Call rolesService.assertCanAssignRole(actor, role) — or assertCanAssignRoleById through\n' +
      '  RoleDelegationPort from outside the roles module — before persisting. Nobody hands out\n' +
      '  rights they do not hold, and that has to be true at every site, not at the two somebody\n' +
      `  remembered. If this site genuinely predates any actor (tenant provisioning), annotate it\n` +
      `  with \`${ALLOW}\` and say why.\n`,
  );
  process.exit(1);
}

console.log('✓ role-assignment: every assignment site passes the delegation check.');
