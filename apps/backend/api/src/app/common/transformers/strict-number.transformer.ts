import { applyDecorators } from '@nestjs/common';
import { Transform, TransformFnParams } from 'class-transformer';

/**
 * A JSON number, as it was sent — not a string the implicit conversion turned into one (FIN-JE-05).
 *
 * The API converts types implicitly before validating, which a query string needs (`?page=2`) and a
 * money field does not: `"debit": "100"` passed `@IsNumber` because it had become `100` first, and so
 * would `" 100 "` or `"1e2"`. The conversion runs before a `@Transform`, so this hands the validator
 * the value the request carried (`obj[key]`), and `@IsNumber` refuses a string with its own message.
 */
export function strictNumber({ value, key, obj }: Pick<TransformFnParams, 'value' | 'key' | 'obj'>): unknown {
  return obj && typeof obj === 'object' && key in obj ? (obj as Record<string, unknown>)[key] : value;
}

export const StrictNumber = () => applyDecorators(Transform(strictNumber));
