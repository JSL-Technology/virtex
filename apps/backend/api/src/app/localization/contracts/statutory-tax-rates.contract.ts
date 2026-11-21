import { EntityManager } from 'typeorm';

/**
 * The consumption-tax rates a country's law levies on a date (audit 2026-11-07, LOC-06, FAC-TX-03).
 *
 * Read from `statutory_tax_rates`, where every rate carries its period and legal basis, so an
 * invoice dated before a rate change is validated against the rate in force THEN. Exposed as a
 * contract so sales, purchasing and e-invoicing read the same rows without importing the
 * localization module's internals.
 *
 * Returns, as fractions:
 *  - `null` when the market has no national table at all (the United States, Brazil): there is
 *    nothing to constrain the rate with at national level;
 *  - `[]` when the market has a table but nothing is in force on that date — a document dated
 *    before the earliest period recorded. The caller must refuse rather than guess.
 */
export async function statutoryTaxRatesOn(
  manager: EntityManager,
  countryCode: string | null | undefined,
  date: string,
): Promise<number[] | null> {
  const country = (countryCode ?? '').trim().toUpperCase();
  if (!country) return null;
  const rows: Array<{ rate: string; in_force: boolean }> = await manager.query(
    `SELECT "rate", ("effective_from" <= $2::date AND ("effective_to" IS NULL OR "effective_to" >= $2::date)) AS in_force
       FROM "statutory_tax_rates" WHERE "country_code" = $1`,
    [country, date],
  );
  if (rows.length === 0) return null;
  return [...new Set(rows.filter((row) => row.in_force).map((row) => Number(row.rate) / 100))].sort((a, b) => b - a);
}
