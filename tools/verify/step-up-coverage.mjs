#!/usr/bin/env node
/**
 * Fails the build when a route guarded by a sensitive permission does not also demand step-up.
 *
 * ## Why this exists
 *
 * Step-up was declared route by route, and route by route it drifted: payslips asked for it while
 * the salary history and the bank account of the same employee did not; approving payroll asked
 * for it while paying a supplier or moving money between banks did not. The level of a control is
 * set by its weakest route, so "which permissions are sensitive" is written down HERE, once, and
 * every route that uses one of them must re-authenticate.
 *
 * A permission is listed with the methods it is sensitive for: some are sensitive to read
 * (compensation, sensitive personal data), others only to change (a bank account).
 *
 * A route that is deliberately exempt carries `step-up-exempt:` with the reason, within the
 * decorators above it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SCAN_DIR = join(ROOT, 'apps', 'backend', 'api', 'src', 'app');
const EXEMPT = 'step-up-exempt:';

const ALL = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** Permission constant → the HTTP methods for which it demands a fresh proof of identity. */
const SENSITIVE = {
  // Money leaving or moving.
  PAYROLL_APPROVE: WRITES,
  PAYROLL_PAY: WRITES,
  ACCOUNTS_PAYABLE_PAY: WRITES,
  TREASURY_TRANSFER: WRITES,
  TREASURY_MANAGE_ACCOUNTS: WRITES,
  BILLING_MANAGE: WRITES,
  // What people are paid, and their most sensitive personal data.
  PAYROLL_VIEW_COMPENSATION: ALL,
  PAYROLL_EDIT_COMPENSATION: ALL,
  PAYROLL_PARAMETERS_MANAGE: WRITES,
  HCM_VIEW_SENSITIVE: ALL,
  // Power over other people's accounts and over the authorization graph.
  USERS_IMPERSONATE: ALL,
  USERS_CREATE: ['POST'],
  USERS_EDIT: ['PATCH', 'PUT', 'POST'],
  USERS_DELETE: WRITES,
  USERS_MANAGE_STATUS: WRITES,
  USERS_PASSWORD_RESET: WRITES,
  USERS_FORCE_LOGOUT: WRITES,
  USERS_SESSIONS_FORENSICS: ALL,
};

const ROUTE = /@(Get|Post|Put|Patch|Delete)\(/;
const HANDLER = /^\s*(?:async\s+)?[a-zA-Z_$][\w$]*\s*\(/;

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of collect(SCAN_DIR)) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  const classHeader = lines.slice(0, lines.findIndex((l) => /export class/.test(l)) + 1).join('\n');
  const classStepUp = /RequireStepUp\(|@StepUp\(/.test(classHeader);

  lines.forEach((line, index) => {
    const route = line.match(ROUTE);
    if (!route) return;
    const method = route[1].toUpperCase();

    // The decorator block: from this route decorator down to the handler signature, plus the
    // decorators stacked above it up to the previous blank line or closing brace.
    let end = index;
    while (end < lines.length - 1 && !HANDLER.test(lines[end]) ) end++;
    let start = index;
    while (start > 0 && lines[start - 1].trim() !== '' && !/^\s*}/.test(lines[start - 1])) start--;
    const block = lines.slice(start, end + 1).join('\n');

    const permissions = [...block.matchAll(/PERMISSIONS\.([A-Z_]+)/g)].map((m) => m[1]);
    const demanded = permissions.filter((p) => SENSITIVE[p]?.includes(method));
    if (!demanded.length) return;

    const hasStepUp = classStepUp || /RequireStepUp\(|@StepUp\(/.test(block);
    if (hasStepUp || block.includes(EXEMPT)) return;
    violations.push({ file: rel, line: index + 1, method, permissions: demanded });
  });
}

if (violations.length) {
  console.error(`\n✗ step-up-coverage: ${violations.length} sensitive route(s) do not re-authenticate.\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.method} guarded by ${v.permissions.join(', ')}`);
  }
  console.error(
    '\n  Add @RequireStepUp(scope) (or @UseGuards(StepUpGuard) + @StepUp(scope)). If the route is\n' +
      `  genuinely exempt, say why with \`${EXEMPT} <reason>\` above it.\n`,
  );
  process.exit(1);
}
console.log('✓ step-up-coverage: every route behind a sensitive permission re-authenticates.');
