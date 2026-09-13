import { ValueTransformer } from 'typeorm';

/**
 * An optional text column that is unique must store `null` for "not given", never `''`.
 *
 * ## The defect this prevents
 *
 * A partial unique index — `UNIQUE (organization_id, sku) WHERE sku IS NOT NULL` — exists so that
 * many products may have no SKU while no two may share one. Postgres does exactly that, and the
 * exemption is for `NULL`: two rows with `sku = ''` are two rows with the same value, and the
 * second is refused.
 *
 * An HTML form sends an untouched text input as the empty string. So the first product created
 * without a SKU stored `''`, and the SECOND came back `409 A record with that data already
 * exists` — naming no field, about a product whose name nobody else had used. Measured in the
 * running application: create one product with no SKU, then another, and the second cannot be
 * saved. The same shape applies to a customer's tax id, an organization's, and a bank account
 * number.
 *
 * Doing it in a transformer rather than in each service is what stops it coming back: the rule
 * belongs to the column, and a new endpoint that writes the same column inherits it without
 * anybody remembering.
 *
 * Trimming is part of the same rule: `' '` is not a SKU either, and a value with a stray trailing
 * space is a duplicate the index cannot see.
 */
export const blankToNullTransformer: ValueTransformer = {
  to: (value: string | null | undefined): string | null => {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    return trimmed === '' ? null : trimmed;
  },
  from: (value: string | null): string | null => value,
};
