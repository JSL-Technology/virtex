import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The analytical materialized view counts MODIFIED entries, like every other ledger reader
 * (GL-01, `LEDGER_STATUSES`). It used to filter `status = 'Posted'`, so a modification's
 * reversal was in the cube while the original it reverses was not.
 *
 * The view is rebuilt with the same shape the analytical service builds (dynamic dimension
 * columns included), its indexes are recreated — the unique one is what lets the service refresh
 * it CONCURRENTLY — and TypeORM's recorded definition is updated so the entity and the database
 * describe the same view.
 */
export class AnalyticalViewLedgerStatuses1789320000000 implements MigrationInterface {
  name = 'AnalyticalViewLedgerStatuses1789320000000';

  public async up(q: QueryRunner): Promise<void> {
    await this.rebuild(q, `('Posted', 'Modified')`);
    await q.query(
      `UPDATE "typeorm_metadata"
          SET "value" = replace("value", '"je"."status" = ''Posted''', '"je"."status" IN (''Posted'', ''Modified'')')
        WHERE "type" = 'MATERIALIZED_VIEW' AND "name" = 'analytical_report_data'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await this.rebuild(q, `('Posted')`);
    await q.query(
      `UPDATE "typeorm_metadata"
          SET "value" = replace("value", '"je"."status" IN (''Posted'', ''Modified'')', '"je"."status" = ''Posted''')
        WHERE "type" = 'MATERIALIZED_VIEW' AND "name" = 'analytical_report_data'`,
    );
  }

  private async rebuild(q: QueryRunner, statuses: string): Promise<void> {
    await q.query(`DROP MATERIALIZED VIEW IF EXISTS "analytical_report_data"`);

    const dimensions: Array<{ name: string }> = await q.query(`SELECT DISTINCT "name" FROM "dimensions"`);
    const dynamicColumns = dimensions
      .map((dim) => `jel.dimensions ->> '${dim.name.replace(/'/g, "''")}' AS "${dim.name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}"`)
      .join(',\n');

    await q.query(`
      CREATE MATERIALIZED VIEW "analytical_report_data" AS
      SELECT
          je.id AS journal_entry_id,
          jel.id AS journal_entry_line_id,
          je.organization_id,
          jlv.ledger_id,
          je.date,
          EXTRACT(YEAR FROM je.date) AS year,
          EXTRACT(MONTH FROM je.date) AS month,
          EXTRACT(QUARTER FROM je.date) AS quarter,
          jel.account_id,
          (SELECT string_agg(seg."value", '-' ORDER BY seg."order")
             FROM "account_segments" seg
            WHERE seg."account_id" = acc."id") AS account_code,
          acc.name AS account_name,
          acc.type AS account_type,
          acc.category AS account_category,
          jlv.debit,
          jlv.credit,
          (jlv.debit - jlv.credit) AS net_change
          ${dynamicColumns ? `, ${dynamicColumns}` : ''}
      FROM journal_entry_lines jel
      INNER JOIN journal_entries je ON jel.journal_entry_id = je.id
      INNER JOIN accounts acc ON jel.account_id = acc.id
      INNER JOIN journal_entry_line_valuations jlv ON jlv.journal_entry_line_id = jel.id
      WHERE je.status IN ${statuses}
    `);

    await q.query(`CREATE INDEX IF NOT EXISTS idx_analytical_data_org_ledger_date ON "analytical_report_data" (organization_id, ledger_id, date)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_analytical_data_account ON "analytical_report_data" (account_id)`);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_analytical_report_data_line_ledger"
        ON "analytical_report_data" ("journal_entry_line_id", "ledger_id")
    `);
  }
}
