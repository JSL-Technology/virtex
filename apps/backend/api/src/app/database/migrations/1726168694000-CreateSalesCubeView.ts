import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefactorAnalyticalViewForDynamicDimensions1726168695000 implements MigrationInterface {
    name = 'RefactorAnalyticalViewForDynamicDimensions1726168695000'

    public async up(queryRunner: QueryRunner): Promise<void> {

        await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS "analytical_report_data"`);
        await queryRunner.query(`DROP VIEW IF EXISTS "sales_cube_view"`);


        // Raw SQL, not the entity: a migration runs against the schema of ITS moment, and the entity
        // describes today's. Reading `Dimension` failed the whole chain the day the entity gained a
        // column this migration predates.
        const dimensions: Array<{ name: string }> = await queryRunner.query(`SELECT "name" FROM "dimensions"`);
        let dynamicDimensionColumns = '';
        if (dimensions.length > 0) {
            dynamicDimensionColumns = dimensions
                .map(dim => `jel.dimensions ->> '${dim.name}' AS "${this.sanitizeColumnName(dim.name)}"`)
                .join(',\n');
        }

        const viewQuery = `
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
                ${dynamicDimensionColumns ? `, ${dynamicDimensionColumns}` : ''}
            FROM
                journal_entry_lines jel
            INNER JOIN
                journal_entries je ON jel.journal_entry_id = je.id
            INNER JOIN
                accounts acc ON jel.account_id = acc.id
            INNER JOIN
                journal_entry_line_valuations jlv ON jlv.journal_entry_line_id = jel.id
            WHERE
                je.status = 'Posted';
        `;

        await queryRunner.query(viewQuery);


        await queryRunner.query(`CREATE INDEX idx_analytical_data_org_ledger_date ON "analytical_report_data" (organization_id, ledger_id, date);`);
        await queryRunner.query(`CREATE INDEX idx_analytical_data_account ON "analytical_report_data" (account_id);`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS "analytical_report_data"`);
    }
    
    private sanitizeColumnName(name: string): string {
        return name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    }
}