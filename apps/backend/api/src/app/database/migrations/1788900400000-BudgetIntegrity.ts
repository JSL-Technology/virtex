import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A budget that could be duplicated, and lines that could shadow each other.
 *
 * `checkBudget` looks up one budget by tenant and period and takes `findOne`; `findMatchingBudgetLine`
 * takes the first line matching an account and its dimensions. Neither had a constraint behind it:
 *
 * - **Two budgets for the same month.** Nothing prevented it, so the control enforced whichever
 *   row PostgreSQL returned, and which one that is can change between two identical requests.
 * - **A period stored in the wrong shape.** The column is documented as `YYYY-MM` and the key is
 *   derived from the transaction date in exactly that shape. A row saved as `2026-3` matches
 *   nothing, ever, and the budget silently does not apply — the most dangerous failure a control
 *   can have, because it looks like compliance.
 * - **Two lines for the same account and cost centre.** The second was invisible, including to
 *   whoever entered it.
 *
 * `dimensions` becomes `NOT NULL` because a unique index treats two NULLs as distinct:
 * left nullable, the index would still allow the same account to be budgeted twice at the account
 * level, which is the duplicate it exists to prevent.
 *
 * The relation column is renamed from `budgetId` to `budget_id`, matching every other foreign key
 * in the schema and letting the unique index be declared on the entity rather than only here.
 */
export class BudgetIntegrity1788900400000 implements MigrationInterface {
  name = 'BudgetIntegrity1788900400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "budget_lines" RENAME COLUMN "budgetId" TO "budget_id"
    `);

    await queryRunner.query(`
      UPDATE "budget_lines" SET "dimensions" = '{}'::jsonb WHERE "dimensions" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "budget_lines"
        ALTER COLUMN "dimensions" SET NOT NULL
    `);

    // Duplicates cannot be resolved by choosing one: the amounts differ and only the owner knows
    // which is meant. The later rows are folded into the earliest by summing, which is the reading
    // that loses no budget — and is visible, because the surviving line's amount changes.
    await queryRunner.query(`
      WITH ranked AS (
        SELECT "id", "budget_id", "account_id", "dimensions", "amount",
               ROW_NUMBER() OVER (
                 PARTITION BY "budget_id", "account_id", "dimensions" ORDER BY "id"
               ) AS "rank",
               FIRST_VALUE("id") OVER (
                 PARTITION BY "budget_id", "account_id", "dimensions" ORDER BY "id"
               ) AS "keep"
        FROM "budget_lines"
      ),
      folded AS (
        SELECT "keep", SUM("amount") AS "total"
        FROM ranked GROUP BY "keep" HAVING COUNT(*) > 1
      )
      UPDATE "budget_lines" bl
      SET "amount" = f."total"
      FROM folded f
      WHERE bl."id" = f."keep"
    `);
    await queryRunner.query(`
      DELETE FROM "budget_lines" bl
      USING (
        SELECT "id", ROW_NUMBER() OVER (
                 PARTITION BY "budget_id", "account_id", "dimensions" ORDER BY "id"
               ) AS "rank"
        FROM "budget_lines"
      ) d
      WHERE d."id" = bl."id" AND d."rank" > 1
    `);

    // Every line belongs to a budget; the column was nullable only because the relation was
    // declared without one.
    await queryRunner.query(`
      DELETE FROM "budget_lines" WHERE "budget_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "budget_lines" ALTER COLUMN "budget_id" SET NOT NULL
    `);
    // The old constraint was auto-named after the old column. Renaming the column does not rename
    // the constraint, so it is replaced with one named after what it actually guards.
    await queryRunner.query(`
      ALTER TABLE "budget_lines"
        DROP CONSTRAINT IF EXISTS "FK_e4dd62c3eb6b8bcbd4613f802b6",
        DROP CONSTRAINT IF EXISTS "FK_budget_lines_budget",
        ADD CONSTRAINT "FK_budget_lines_budget"
          FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_budget_lines_budget_account_dimensions"
      ON "budget_lines" ("budget_id", "account_id", "dimensions")
    `);

    // A period in the wrong shape matches nothing, so normalising it is a repair rather than a
    // guess: `2026-3` can only ever have meant March 2026.
    await queryRunner.query(`
      UPDATE "budgets"
      SET "period" = split_part("period", '-', 1) || '-' ||
                     lpad(split_part("period", '-', 2), 2, '0')
      WHERE "period" ~ '^[0-9]{4}-[0-9]{1,2}$' AND "period" !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    `);
    // A period that is not a year and a month at all cannot be repaired. Suffixing the name and
    // moving it to a period that matches nothing would hide it; leaving it fails the constraint
    // loudly, which is the correct outcome for data nobody can interpret. It is deleted only if it
    // has no lines, because an empty budget in an unreadable period carries no information.
    await queryRunner.query(`
      DELETE FROM "budgets" b
      WHERE b."period" !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
        AND NOT EXISTS (SELECT 1 FROM "budget_lines" l WHERE l."budget_id" = b."id")
    `);

    await queryRunner.query(`
      ALTER TABLE "budgets"
        DROP CONSTRAINT IF EXISTS "CHK_budgets_period_format",
        ADD CONSTRAINT "CHK_budgets_period_format"
          CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
    `);

    // Two budgets for one month: keep the newest, rename the others so nothing is lost and the
    // collision is visible in the list rather than resolved behind the user's back.
    await queryRunner.query(`
      UPDATE "budgets" b
      SET "period" = b."period", "name" = b."name" || ' (duplicado ' || d."rank"::text || ')'
      FROM (
        SELECT "id", ROW_NUMBER() OVER (
                 PARTITION BY "organization_id", "period" ORDER BY "created_at" DESC, "id"
               ) - 1 AS "rank"
        FROM "budgets"
      ) d
      WHERE d."id" = b."id" AND d."rank" > 0
    `);
    await queryRunner.query(`
      DELETE FROM "budgets" b
      USING (
        SELECT "id", ROW_NUMBER() OVER (
                 PARTITION BY "organization_id", "period" ORDER BY "created_at" DESC, "id"
               ) AS "rank"
        FROM "budgets"
      ) d
      WHERE d."id" = b."id" AND d."rank" > 1
        AND NOT EXISTS (SELECT 1 FROM "budget_lines" l WHERE l."budget_id" = b."id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_budgets_org_period"
      ON "budgets" ("organization_id", "period")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_budgets_org_period"`);
    await queryRunner.query(`
      ALTER TABLE "budgets" DROP CONSTRAINT IF EXISTS "CHK_budgets_period_format"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_budget_lines_budget_account_dimensions"`);
    await queryRunner.query(`
      ALTER TABLE "budget_lines"
        DROP CONSTRAINT IF EXISTS "FK_budget_lines_budget",
        ALTER COLUMN "budget_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "budget_lines"
        ALTER COLUMN "dimensions" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "budget_lines" RENAME COLUMN "budget_id" TO "budgetId"
    `);
  }
}
