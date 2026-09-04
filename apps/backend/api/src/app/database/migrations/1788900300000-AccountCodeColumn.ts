import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The account code becomes a column instead of a getter over a relation.
 *
 * `Account.code` was computed on read by joining the `account_segments` rows and concatenating
 * them. It worked when the relation happened to be loaded and returned the **empty string** when it
 * was not — a partial `select`, an entity built in memory, any query that did not ask for the
 * relation. Nothing threw: the reports simply showed accounts with no code, and the consolidation
 * grouped every account of every company under the same blank key, collapsing four separate
 * balances into one line.
 *
 * Storing it also makes three other things possible that were not:
 *
 * - **Uniqueness.** There was no constraint. The duplicate check was a
 *   `STRING_AGG(segment.value, '-' ORDER BY segment.order) = :code` aggregate over every account of
 *   the organization, evaluated before the insert — a check-then-act race with nothing behind it,
 *   so two concurrent requests could both create account `1101`.
 * - **Ordering and filtering in SQL.** The chart of accounts, the trial balance and the general
 *   ledger are all presented in code order, and each had to load every account into memory to sort.
 * - **An index.** Any lookup by code was a full scan plus an aggregate.
 *
 * The segments stay: they are the structured form a tenant configures and validates against. This
 * column is their canonical rendering, written whenever they are, and the code is immutable after
 * creation — `update` already refuses to change it — so the two cannot drift.
 *
 * The backfill reads the segments in `order`, which is exactly what the getter did. Accounts with
 * no segments at all — none should exist, but nothing prevented them — fall back to the first eight
 * characters of their id so the NOT NULL and the unique index can be applied without discarding an
 * account that may carry a balance.
 */
export class AccountCodeColumn1788900300000 implements MigrationInterface {
  name = 'AccountCodeColumn1788900300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "code" character varying(200)`,
    );

    await queryRunner.query(`
      UPDATE "accounts" a
      SET "code" = s."full_code"
      FROM (
        SELECT "account_id", STRING_AGG("value", '-' ORDER BY "order") AS "full_code"
        FROM "account_segments"
        GROUP BY "account_id"
      ) s
      WHERE s."account_id" = a."id" AND a."code" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "accounts"
      SET "code" = LEFT(REPLACE("id"::text, '-', ''), 8)
      WHERE "code" IS NULL OR "code" = ''
    `);

    // A tenant that already holds two accounts with the same code cannot take the unique index as
    // it stands, and there is no correct answer to which of them keeps the code. Suffixing the
    // later ones keeps every account and its balances, and makes the collision visible in the chart
    // rather than silently resolving it.
    await queryRunner.query(`
      UPDATE "accounts" a
      SET "code" = a."code" || '-' || d."rank"::text
      FROM (
        SELECT "id",
               ROW_NUMBER() OVER (
                 PARTITION BY "organization_id", "code" ORDER BY "created_at", "id"
               ) - 1 AS "rank"
        FROM "accounts"
      ) d
      WHERE d."id" = a."id" AND d."rank" > 0
    `);

    await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "code" SET NOT NULL`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_accounts_org_code"
      ON "accounts" ("organization_id", "code")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_accounts_org_code"`);
    await queryRunner.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "code"`);
  }
}
