#!/usr/bin/env node
/**
 * Fails the build when an organization's plan is written anywhere but `SaasService.applyPlan`.
 *
 * ## Why this exists
 *
 * Seven places assigned `organization.plan` — the paid signup, the development grant, a subsidiary's
 * creation, the browser's return from checkout, two webhook handlers and the simulated provider —
 * and none of them wrote `organization_subscription_history`. The only method that did was called by
 * nothing, so the table that answers «what was this customer on, and since when» was empty in every
 * environment while plans kept changing; and the one webhook that should have changed a plan, when
 * the customer changed it at the payment provider, never did.
 *
 * `applyPlan` is the one door: it moves the plan, writes the history row as the tenant it belongs
 * to, and does both in the caller's transaction. Billing state as a whole goes through
 * `payment/billing-state.service.ts`, which calls it for every organization a subscription bills.
 * This check keeps everything else from growing an eighth way.
 *
 * ## What it flags
 *
 * An assignment to `.plan` or `.planId`, an object literal that hands an organization a plan id
 * (`planId: parent.planId`, `{ planId: plan.id }`), and raw SQL that sets `plan_id` on
 * `organizations`. Annotate a genuine exception with `plan-writes-allow` and say why.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SCAN_DIR = join(ROOT, 'apps', 'backend', 'api', 'src', 'app');
const ALLOW = 'plan-writes-allow';
const WRITER = join('saas', 'saas.service.ts');

const PATTERNS = [
  { pattern: /\.(?:plan|planId)\s*=(?!=)/, what: 'assigns a plan to an object' },
  { pattern: /\bplanId\s*:\s*[A-Za-z_$][\w$.]*(?:\.id|Id)\b/, what: 'hands an organization a plan id in an object literal' },
  { pattern: /UPDATE\s+"?organizations"?\s+SET\b[^;]*\bplan_id\b/i, what: 'sets plan_id on organizations in SQL' },
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

/** Each line with its comments removed, so a sentence about `organization.plan` is not a write. */
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
  // A migration is history; it is not a way to change a customer's plan at run time.
  if (rel.includes(join('database', 'migrations'))) continue;
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
  console.error(`\n✗ plan-writes: ${violations.length} place(s) change an organization's plan outside SaasService.applyPlan.\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.what}`);
    console.error(`    ${v.code}`);
  }
  console.error(
    '\n  Call saasService.applyPlan(manager, organization, plan, { reason, changedBy }) inside the\n' +
      '  transaction that moves the plan: it writes the history row as the organization it belongs\n' +
      '  to, and invalidating the cache is yours to do after the commit. Billing state as a whole goes\n' +
      '  through BillingStateService. A genuine exception is annotated with\n' +
      `  \`${ALLOW}\`, with the reason.\n`,
  );
  process.exit(1);
}
console.log('✓ plan-writes: every change of plan goes through SaasService.applyPlan.');
