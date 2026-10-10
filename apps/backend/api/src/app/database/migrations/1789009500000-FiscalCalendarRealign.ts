import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Snap every monthly accounting period onto its true calendar month, then give each year the
 * fiscal year its periods describe.
 *
 * ## What this repairs
 *
 * Tenants provisioned before the calendar helpers were made UTC (`common/dates.ts`) carry periods
 * shifted a day early — "Septiembre 2026" stored as `2026-08-31 → 2026-09-29`, "Diciembre 2026"
 * ending `2026-12-30`. Two consequences follow: a month-end date files into the next month, and
 * the last day of the year (`2026-12-31`) falls in no period at all, raising "la fecha no pertenece
 * a ningún período". Worse, the on-demand year opener (`resolvePostingPeriod`, `createIfMissing`)
 * would, seeing the 31st uncovered, create a *second*, correctly-aligned set of twelve periods on
 * top of the shifted ones — overlapping windows a date then resolves to arbitrarily. The shift has
 * to be corrected at the source before any of that can stand.
 *
 * ## How the month is chosen
 *
 * From the midpoint of each period's window, not its name (names are localized and were never the
 * source of truth) and not its start (which is the shifted value). A ~30-day window's midpoint sits
 * squarely inside the month it represents whether it was shifted by a day or not, so an
 * already-aligned period is snapped to exactly where it already is — the migration is idempotent
 * and a no-op for every tenant created after the fix. Only windows that read as monthly (26–35
 * days) are touched; a non-monthly calendar is never reshaped.
 *
 * ## Fiscal years
 *
 * `FiscalYearBackfill` (M-09) tried to give existing tenants the fiscal year their periods already
 * describe, but it ran before this realignment — so on a shifted tenant it read "Enero 2026" as a
 * 2025 period and would have conjured a spurious 2025 year — and, run by a migration role without
 * `BYPASSRLS` against FORCE-RLS tables, its insert matched no rows and `fiscal_years` stayed empty.
 * Re-doing it here, after the realignment, keys each year off the corrected period dates. Any year
 * already covered by a fiscal year of any shape is left alone.
 *
 * ## Row-level security
 *
 * These tables carry FORCE ROW LEVEL SECURITY, so this migration only writes rows when run by a
 * superuser or a `BYPASSRLS` role — exactly what `DB_MIGRATION_USERNAME` is documented to be in
 * `.env.example`. Run under the application role it would silently touch nothing, which is how
 * `fiscal_years` came to be empty in the first place.
 */
export class FiscalCalendarRealign1789009500000 implements MigrationInterface {
  name = 'FiscalCalendarRealign1789009500000';

  public async up(q: QueryRunner): Promise<void> {
    // ── 1. Realign monthly periods onto their calendar month ───────────────────
    await q.query(`
      UPDATE "accounting_periods" p
         SET "start_date" = date_trunc('month', m.mid)::date,
             "end_date"   = (date_trunc('month', m.mid) + interval '1 month' - interval '1 day')::date
        FROM (
          SELECT "id",
                 ("start_date" + (("end_date" - "start_date") / 2))::timestamp AS mid
            FROM "accounting_periods"
           WHERE ("end_date" - "start_date") BETWEEN 26 AND 35
        ) m
       WHERE p."id" = m."id"
         AND (
               p."start_date" <> date_trunc('month', m.mid)::date
            OR p."end_date"   <> (date_trunc('month', m.mid) + interval '1 month' - interval '1 day')::date
             )
    `);

    // ── 2. A fiscal year for every calendar year the (now corrected) periods span ──
    await q.query(`
      INSERT INTO "fiscal_years" ("organization_id", "start_date", "end_date", "status")
      SELECT p."organization_id",
             make_date(p."year", 1, 1),
             make_date(p."year", 12, 31),
             'OPEN'
        FROM (
          SELECT DISTINCT "organization_id", EXTRACT(YEAR FROM "start_date")::int AS "year"
            FROM "accounting_periods"
        ) p
       WHERE NOT EXISTS (
         SELECT 1 FROM "fiscal_years" f
          WHERE f."organization_id" = p."organization_id"
            AND f."start_date" <= make_date(p."year", 12, 31)
            AND f."end_date" >= make_date(p."year", 1, 1)
       )
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(): Promise<void> {
    // Not reversible with certainty. The realignment cannot know a period's shifted origin from its
    // corrected state, and a backfilled year may since have been closed, carry a closing entry, or
    // be the year an audit adjustment was proposed against — removing it would orphan those. There
    // is nothing here that is safe to undo.
  }
}
