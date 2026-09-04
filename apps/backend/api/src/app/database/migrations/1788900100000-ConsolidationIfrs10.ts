import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A group could be described but not consolidated.
 *
 * `organization_subsidiaries` recorded the parent, the subsidiary and an ownership percentage, and
 * that percentage was read exactly once — into a log line. Three facts a consolidation cannot be
 * performed without were missing entirely:
 *
 * - **`acquisition_date`.** NIIF 10.20 consolidates a subsidiary from the date control is obtained,
 *   and NIC 21.39(b) translates its pre-acquisition equity at the rate ruling on that date. Without
 *   it, pre- and post-acquisition reserves cannot be separated and the group is credited with
 *   profits the subsidiary earned before it was bought.
 * - **`acquisition_cost`.** The consideration transferred (NIIF 3.32). It is what the parent's
 *   investment is eliminated against, and the residual is goodwill. With neither, the investment
 *   and the subsidiary's net assets both stayed in the consolidated totals — the same net assets
 *   counted twice.
 * - **`investment_account_id`.** Which of the parent's accounts carries the investment, so the
 *   elimination reaches the actual line rather than guessing at it by name.
 *
 * All three are nullable: a group that has not recorded them still consolidates, and the run
 * reports what it could not do rather than refusing or quietly inventing a figure.
 */
export class ConsolidationIfrs101788900100000 implements MigrationInterface {
  name = 'ConsolidationIfrs101788900100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organization_subsidiaries"
        ADD COLUMN IF NOT EXISTS "acquisition_date" date,
        ADD COLUMN IF NOT EXISTS "acquisition_cost" numeric(18,2),
        ADD COLUMN IF NOT EXISTS "investment_account_id" uuid
    `);

    // `SET NULL` rather than `CASCADE`: removing an account must never remove the record of who
    // owns whom. The group structure outlives any one chart of accounts.
    await queryRunner.query(`
      ALTER TABLE "organization_subsidiaries"
        DROP CONSTRAINT IF EXISTS "FK_organization_subsidiaries_investment_account",
        ADD CONSTRAINT "FK_organization_subsidiaries_investment_account"
          FOREIGN KEY ("investment_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL
    `);

    // Ownership outside 0–100 is not a percentage. Nothing enforced it, and the value feeds the
    // non-controlling interest split directly: 150 % ownership produces a negative NCI, which reads
    // as a real figure on a real balance sheet.
    await queryRunner.query(`
      ALTER TABLE "organization_subsidiaries"
        DROP CONSTRAINT IF EXISTS "CHK_organization_subsidiaries_ownership",
        ADD CONSTRAINT "CHK_organization_subsidiaries_ownership"
          CHECK ("ownership" >= 0 AND "ownership" <= 100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organization_subsidiaries"
        DROP CONSTRAINT IF EXISTS "CHK_organization_subsidiaries_ownership",
        DROP CONSTRAINT IF EXISTS "FK_organization_subsidiaries_investment_account"
    `);
    await queryRunner.query(`
      ALTER TABLE "organization_subsidiaries"
        DROP COLUMN IF EXISTS "investment_account_id",
        DROP COLUMN IF EXISTS "acquisition_cost",
        DROP COLUMN IF EXISTS "acquisition_date"
    `);
  }
}
