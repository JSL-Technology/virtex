import { WORKFLOW_LIMITS, WorkflowPredicate } from './workflow-graph';

/**
 * Evaluate a {@link WorkflowPredicate} against an instance's context.
 *
 * Safe by construction: it walks a data tree, it never compiles or runs a string, and an operand it
 * does not understand is false rather than an exception — a malformed condition stalls the branch it
 * guards, it does not crash the engine or, worse, evaluate to an attacker's advantage. Depth is
 * bounded, so a hostile tree cannot exhaust the stack.
 */
export function evaluatePredicate(
  predicate: WorkflowPredicate | undefined | null,
  context: Record<string, unknown>,
  depth = 0,
): boolean {
  if (!predicate || typeof predicate !== 'object') return false;
  if (depth > WORKFLOW_LIMITS.maxPredicateDepth) return false;

  if ('all' in predicate) {
    return Array.isArray(predicate.all) && predicate.all.every((p) => evaluatePredicate(p, context, depth + 1));
  }
  if ('any' in predicate) {
    return Array.isArray(predicate.any) && predicate.any.some((p) => evaluatePredicate(p, context, depth + 1));
  }
  if ('not' in predicate) return !evaluatePredicate(predicate.not, context, depth + 1);

  const left = getPath(context, predicate.var);
  const right = predicate.value;

  switch (predicate.op) {
    case 'exists':
      return !isEmpty(left);
    case 'not_exists':
      return isEmpty(left);
    case 'truthy':
      return Boolean(left);
    case 'falsy':
      return !left;
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
      return contains(left, right);
    case 'not_contains':
      return !contains(left, right);
    case 'starts_with':
      return typeof left === 'string' && right !== undefined && right !== null && left.toLowerCase().startsWith(String(right).toLowerCase());
    case 'ends_with':
      return typeof left === 'string' && right !== undefined && right !== null && left.toLowerCase().endsWith(String(right).toLowerCase());
    default:
      return false;
  }
}

/** Read a dotted path (`invoice.total`) out of a nested object, or undefined. */
export function getPath(source: Record<string, unknown>, path: string): unknown {
  if (!path || typeof path !== 'string') return undefined;
  let current: unknown = source;
  for (const segment of path.split('.')) {
    // Never walk into the prototype chain: `constructor.prototype` must not be reachable.
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Every variable path a predicate reads, for validation and the designer's hints. */
export function predicateVariables(predicate: WorkflowPredicate | undefined | null, out = new Set<string>(), depth = 0): Set<string> {
  if (!predicate || typeof predicate !== 'object' || depth > WORKFLOW_LIMITS.maxPredicateDepth) return out;
  if ('all' in predicate) predicate.all?.forEach((p) => predicateVariables(p, out, depth + 1));
  else if ('any' in predicate) predicate.any?.forEach((p) => predicateVariables(p, out, depth + 1));
  else if ('not' in predicate) predicateVariables(predicate.not, out, depth + 1);
  else if (typeof predicate.var === 'string') out.add(predicate.var);
  return out;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function contains(left: unknown, right: unknown): boolean {
  if (right === undefined || right === null) return false;
  if (typeof left === 'string') return left.toLowerCase().includes(String(right).toLowerCase());
  if (Array.isArray(left)) return left.some((item) => looseEquals(item, right));
  return false;
}

/** `===`, but with the number/string coercion jsonb round-trips make unavoidable. */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  return String(a) === String(b);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** A comparable number for an operand: numbers as-is, ISO dates as epoch millis, else NaN. */
function comparable(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return Number.NaN;
    if (ISO_DATE.test(trimmed)) return new Date(trimmed).getTime();
    return Number(trimmed);
  }
  return Number.NaN;
}

/** Numeric (or date) comparison. Incomparable operands are false, never a surprise. */
function compare(a: unknown, b: unknown, test: (x: number, y: number) => boolean): boolean {
  const na = comparable(a);
  const nb = comparable(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  return test(na, nb);
}
