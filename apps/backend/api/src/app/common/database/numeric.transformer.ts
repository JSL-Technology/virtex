import { ValueTransformer } from 'typeorm';

/**
 * Makes a `numeric` column arrive in JavaScript as a number instead of a string.
 *
 * `pg` returns every `numeric` as a string, because an arbitrary-precision decimal does not fit a
 * double without loss. TypeORM passes that through, so an entity that declares `total: number` is
 * lying: at run time it holds `"1180.00"`. The code around the invoice module then relied on
 * implicit coercion — `price * quantity` works, `line.amount > invoice.balance` works by accident,
 * and `subtotal += lineTotal` silently concatenates the moment one operand is a string. That class
 * of bug does not throw; it produces a wrong number on a fiscal document.
 *
 * Declaring the transformer makes the type annotation true. Precision is not lost for the ranges an
 * invoice deals in: IEEE-754 doubles represent every integer up to 2^53 exactly, so an amount with
 * two decimals is exact up to 90 trillion units — far beyond any currency amount the product will
 * see, including Guaraní and Colombian pesos.
 */
export const numericTransformer: ValueTransformer = {
  to: (value: number | string | null | undefined): number | string | null => {
    if (value === null || value === undefined) return null;
    return value;
  },
  from: (value: string | number | null): number | null => {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  },
};

/**
 * Same, for a column that must never be null: a missing value reads as 0 rather than as `null`
 * masquerading as a number.
 */
export const numericTransformerNotNull: ValueTransformer = {
  to: (value: number | string | null | undefined): number => {
    if (value === null || value === undefined) return 0;
    return typeof value === 'number' ? value : Number(value) || 0;
  },
  from: (value: string | number | null): number => {
    if (value === null || value === undefined) return 0;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  },
};

/**
 * For a `NOT NULL` column whose database DEFAULT is not 0 — an exchange rate (DEFAULT 1), a
 * multiplier, a tolerance (DEFAULT 0.02).
 *
 * `numericTransformerNotNull.to` turns an unset value into an explicit 0, and TypeORM only writes
 * `DEFAULT` when the transformed value is `undefined`. So every settings row was created with
 * `fx_rate_tolerance = 0` instead of 0.02, and every stated exchange rate that differed from the
 * quote by a single unit of the sixth decimal was refused (audit 2026-11-07, XF-09). Here an unset
 * value stays unset and the database applies its own default; an explicit `null` is still refused
 * by the constraint rather than silently rewritten.
 */
export const numericTransformerWithDefault: ValueTransformer = {
  to: (value: number | string | null | undefined): number | string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return typeof value === 'number' ? value : Number(value);
  },
  from: numericTransformerNotNull.from,
};
