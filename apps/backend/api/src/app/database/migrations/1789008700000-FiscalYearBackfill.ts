import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A fiscal year for every calendar year a tenant already has periods in (QA M-09).
 *
 * Provisioning created twelve monthly periods and no `fiscal_years` row, so the annual close —
 * which works on a fiscal year — had nothing to close for any tenant, and the screen could only
 * say there were no years. New tenants now get both together (`ensureFiscalYearWithPeriods`);
 * this gives existing ones the year their periods already describe. A year already covered by a
 * fiscal year of any shape is left alone.
 */
export class FiscalYearBackfill1789008700000 implements MigrationInterface {
  name = 'FiscalYearBackfill1789008700000';

  public async up(q: QueryRunner): Promise<void> {
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
    // Not reversible with certainty: a backfilled year may since have been closed, carry its
    // closing entry, or be the year an audit adjustment was proposed against. Removing it would
    // orphan those. Nothing to undo that is safe to undo.
  }
}
