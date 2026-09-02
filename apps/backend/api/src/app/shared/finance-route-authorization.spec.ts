import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Every route that touches money declares a permission.
 *
 * ## Why this is a test and not a global guard
 *
 * `PermissionsGuard` is applied by the `@HasPermission` decorator itself, so a route that declares
 * a permission enforces it. What was missing was the declaration: 59 of the 85 routes across the
 * finance modules had none, leaving them open to any authenticated member of the tenant. Among
 * them: moving funds between accounts, uploading and reconciling a bank statement, approving and
 * voiding supplier invoices, running the year-end close, and editing the chart of accounts.
 *
 * Registering the guard globally with deny-by-default would catch this, but it would also change
 * the posture of sixty-odd controllers outside accounting in a single commit, which is not a change
 * that can be reviewed honestly. This gate is narrow and exact instead: it fails the build when a
 * new route appears in one of these modules without a permission, which is the failure mode that
 * actually occurred — the controllers protecting manual journal entries were complete, while
 * `recurring-journal-entries.controller.ts`, whose entries the scheduler posts unattended, declared
 * nothing at all.
 */

const APP_ROOT = join(__dirname, '..');

/** Modules whose controllers move, record or report money. */
const FINANCE_MODULES = [
  'accounting',
  'accounts-payable',
  'budgets',
  'chart-of-accounts',
  'consolidation',
  'financial-reporting',
  'journal-entries',
  'reconciliation',
  'taxes',
  'treasury',
];

/** Controllers outside those directories that are nonetheless part of the money surface. */
const EXTRA_CONTROLLERS = [
  'customers/customer-payments.controller.ts',
  'invoices/invoices.controller.ts',
];

const ROUTE_DECORATOR = /^\s*@(Get|Post|Put|Patch|Delete)\(/;
const PERMISSION_DECORATOR = /^\s*@HasPermission\(/;
/** A route deliberately reachable without a session, e.g. a payment webhook. */
const PUBLIC_DECORATOR = /^\s*@Public\(/;

function controllersUnder(directory: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.controller.ts')) found.push(path);
    }
  };
  try {
    walk(directory);
  } catch {
    // A module without a controller directory is not a failure.
  }
  return found;
}

/**
 * Routes in a controller that carry no `@HasPermission` and no `@Public`.
 *
 * Decorators are read as text rather than through metadata reflection: importing the controllers
 * would pull in the whole Nest graph, and the question here is about what the source declares.
 */
function unprotectedRoutes(file: string): string[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const offenders: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!ROUTE_DECORATOR.test(lines[i])) continue;

    // A handler's decorator block runs from the end of the previous class member to its own
    // signature. Walking only contiguous `@` lines is not enough: Swagger decorators span several
    // lines, doc comments and blank lines sit between them, and `@HasPermission` may be declared
    // either side of the HTTP method decorator.
    let start = i;
    while (start > 0 && lines[start - 1].trim() !== '}') start--;
    let end = i;
    while (
      end + 1 < lines.length &&
      !/^\s*(?:public |private |protected |async )*[A-Za-z_$][\w$]*\s*\(/.test(lines[end + 1])
    ) {
      end++;
    }

    const block = lines.slice(start, end + 1);
    const protectedRoute = block.some(
      (line) => PERMISSION_DECORATOR.test(line) || PUBLIC_DECORATOR.test(line),
    );
    if (!protectedRoute) {
      offenders.push(`${file.replace(APP_ROOT, '')}:${i + 1} ${lines[i].trim()}`);
    }
  }

  return offenders;
}

describe('finance route authorization', () => {
  const files = [
    ...FINANCE_MODULES.flatMap((module) => controllersUnder(join(APP_ROOT, module))),
    ...EXTRA_CONTROLLERS.map((relative) => join(APP_ROOT, relative)),
  ];

  it('finds the finance controllers', () => {
    // Guards the guard: a renamed directory would otherwise make this suite pass by checking
    // nothing at all.
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it('declares a permission on every finance route', () => {
    const offenders = files.flatMap(unprotectedRoutes);
    expect(offenders).toEqual([]);
  });

  it.each(files)('%s declares a permission on every route', (file) => {
    expect(unprotectedRoutes(file)).toEqual([]);
  });
});
