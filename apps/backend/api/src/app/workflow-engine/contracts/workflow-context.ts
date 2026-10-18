import { WORKFLOW_LIMITS, WorkflowVariable } from './workflow-graph';

/** Keys that would reach an object's prototype chain. A regex, not quoted names: those read as catalogue keys to the i18n scan. */
const FORBIDDEN_KEY = /^(?:__proto__|constructor|prototype)$/;

/**
 * A deep copy of caller-supplied process data that is safe to store and evaluate.
 *
 * It drops keys that could pollute prototypes when the context is later merged, cuts depth and
 * size, and keeps only JSON values — a context comes from request bodies and business events, and
 * it is merged into objects the engine reads paths from.
 */
export function sanitizeContext(value: unknown, depth = 0): Record<string, unknown> {
  const clean = sanitizeValue(value, depth);
  return clean && typeof clean === 'object' && !Array.isArray(clean) ? (clean as Record<string, unknown>) : {};
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 6) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 4000 ? value.slice(0, 4000) : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 500)) {
      if (FORBIDDEN_KEY.test(key) || key.length > 120) continue;
      out[key] = sanitizeValue(item, depth + 1);
    }
    return out;
  }
  return null;
}

export function contextTooLarge(context: Record<string, unknown>): boolean {
  return JSON.stringify(context).length > WORKFLOW_LIMITS.maxContextBytes;
}

export interface FieldProblem {
  field: string;
  code: 'required' | 'type' | 'option' | 'min' | 'max';
}

/**
 * Check values against declared variables (a start form or a task form) and coerce them to their
 * declared type. Unknown names pass through untouched — a start may carry extra event data.
 */
export function coerceFields(
  fields: readonly WorkflowVariable[],
  values: Record<string, unknown>,
): { values: Record<string, unknown>; problems: FieldProblem[] } {
  const out: Record<string, unknown> = { ...values };
  const problems: FieldProblem[] = [];
  for (const field of fields) {
    const raw = values[field.name];
    const empty = raw === undefined || raw === null || raw === '';
    if (empty) {
      if (field.required) problems.push({ field: field.name, code: 'required' });
      continue;
    }
    switch (field.type) {
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
        if (!Number.isFinite(n)) problems.push({ field: field.name, code: 'type' });
        else if (field.min !== undefined && n < field.min) problems.push({ field: field.name, code: 'min' });
        else if (field.max !== undefined && n > field.max) problems.push({ field: field.name, code: 'max' });
        else out[field.name] = n;
        break;
      }
      case 'boolean': {
        if (typeof raw === 'boolean') break;
        if (raw === 'true' || raw === 'false') out[field.name] = raw === 'true';
        else problems.push({ field: field.name, code: 'type' });
        break;
      }
      case 'date': {
        const time = new Date(String(raw)).getTime();
        if (Number.isNaN(time)) problems.push({ field: field.name, code: 'type' });
        else out[field.name] = String(raw);
        break;
      }
      case 'select':
        if (!(field.options ?? []).includes(String(raw))) problems.push({ field: field.name, code: 'option' });
        break;
      case 'user':
        if (!/^[0-9a-f-]{36}$/i.test(String(raw))) problems.push({ field: field.name, code: 'type' });
        break;
      default:
        out[field.name] = String(raw).slice(0, field.type === 'text' ? 4000 : 500);
    }
  }
  return { values: out, problems };
}
