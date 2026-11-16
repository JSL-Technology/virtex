import { applyDecorators } from '@nestjs/common';
import { Transform, TransformFnParams } from 'class-transformer';

/** What a person types in a yes/no cell, in the product's languages. */
const TRUE = new Set(['true', '1', 'yes', 'y', 'si', 'sí', 's', 'sim', 'verdadero', 'verdadeiro', 'x']);
const FALSE = new Set(['false', '0', 'no', 'n', 'nao', 'não', 'falso']);

/**
 * A yes/no cell of an imported file, as a boolean.
 *
 * A cell is text, and converted implicitly `"false"` is a non-empty string — `true`: an imported
 * heading would start taking postings, an inactive account would come back active. The implicit
 * conversion runs before a `@Transform`, so this reads the cell as the file had it (`obj[key]`).
 * Recognised, whatever the case: true/false, 1/0, yes/no, sí/no, sim/não, verdadero/falso,
 * verdadeiro/falso and an `x` for a ticked box. Anything else is left as it was, for
 * `@IsBoolean` to refuse with its own message.
 */
export function spreadsheetBoolean({ value, key, obj }: Pick<TransformFnParams, 'value' | 'key' | 'obj'>): unknown {
  const raw = obj && typeof obj === 'object' && key in obj ? (obj as Record<string, unknown>)[key] : value;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1 ? true : raw === 0 ? false : raw;
  if (typeof raw !== 'string') return raw;
  const token = raw.trim().toLowerCase();
  if (TRUE.has(token)) return true;
  if (FALSE.has(token)) return false;
  return raw;
}

export const SpreadsheetBoolean = () => applyDecorators(Transform(spreadsheetBoolean));

/** A code a file may write in any case (`asset`, `Asset`), as the catalogue spells it. */
export function upperCaseCode({ value, key, obj }: Pick<TransformFnParams, 'value' | 'key' | 'obj'>): unknown {
  const raw = obj && typeof obj === 'object' && key in obj ? (obj as Record<string, unknown>)[key] : value;
  return typeof raw === 'string' ? raw.trim().toUpperCase() : raw;
}

export const UpperCaseCode = () => applyDecorators(Transform(upperCaseCode));
