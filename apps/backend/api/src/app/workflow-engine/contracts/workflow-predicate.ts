import { WorkflowPredicate } from './workflow-graph';

/**
 * Evaluate a {@link WorkflowPredicate} against an instance's context.
 *
 * Safe by construction: it walks a data tree, it never compiles or runs a string, and an operand it
 * does not understand is false rather than an exception — a malformed condition stalls the branch it
 * guards, it does not crash the engine or, worse, evaluate to an attacker's advantage.
 */
export function evaluatePredicate(
  predicate: WorkflowPredicate | undefined | null,
  context: Record<string, unknown>,
): boolean {
  if (!predicate) return false;

  if ('all' in predicate) return predicate.all.every((p) => evaluatePredicate(p, context));
  if ('any' in predicate) return predicate.any.some((p) => evaluatePredicate(p, context));
  if ('not' in predicate) return !evaluatePredicate(predicate.not, context);

  const left = getPath(context, predicate.var);
  const right = predicate.value;

  switch (predicate.op) {
    case 'exists':
      return left !== undefined && left !== null;
    case 'truthy':
      return Boolean(left);
    case 'eq':
      return looseEquals(left, right);
    case 'ne':
      return !looseEquals(left, right);
    case 'gt':
      return compare(left, right, (a, b) => a > b);
    case 'gte':
      return compare(left, right, (a, b) => a >= b);
    case 'lt':
      return compare(left, right, (a, b) => a < b);
    case 'lte':
      return compare(left, right, (a, b) => a <= b);
    case 'in':
      return Array.isArray(right) && right.some((item) => looseEquals(left, item));
    case 'nin':
      return !(Array.isArray(right) && right.some((item) => looseEquals(left, item)));
    case 'contains':
      if (typeof left === 'string') return left.includes(String(right));
      if (Array.isArray(left)) return left.some((item) => looseEquals(item, right));
      return false;
    default:
      return false;
  }
}

/** Read a dotted path (`invoice.total`) out of a nested object, or undefined. */
export function getPath(source: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** `===`, but with the number/string coercion jsonb round-trips make unavoidable. */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  return String(a) === String(b);
}

/** Numeric comparison. Incomparable operands (either side not a number) are false, never a surprise. */
function compare(a: unknown, b: unknown, test: (x: number, y: number) => boolean): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  return test(na, nb);
}
