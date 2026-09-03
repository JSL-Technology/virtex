import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bank reconciliation becomes a reconciliation.
 *
 * ## What the schema could not express
 *
 * `bank_transactions.matched_entry_line_id` was a single nullable column, so one statement line
 * could clear exactly one ledger line. Neither everyday case fits: a deposit slip covering five
 * cheques is one statement line against five ledger lines, and a transfer whose fee the bank
 * charged separately is one ledger entry against two statement lines. Matching moves to
 * `reconciliation_matches`, a many-to-many the service will only write when both sides sum to the
 * same figure — which is also what makes the balance proof computable, because everything outside a
 * match is by definition an item one side has not seen.
 *
 * `bank_statements.account_id` was a **chart-of-accounts** id: a statement belonged to a control
 * account rather than to an account at a bank, so four accounts posting to `1102 Bancos` produced
 * four statements nothing could tell apart. It points at `bank_accounts` now.
 *
 * `reconciliation_rules.organization_id` was an unconstrained `character varying` with no foreign
 * key and no index, and `target_account_id` likewise — a rule could name an account in another
 * tenant, or one that had been deleted.
 *
 * ## Data
 *
 * Statement rows carry a control-account id where a bank-account id is now required, and which of
 * the accounts posting to that control account a statement came from was never recorded — it cannot
 * be recovered. Existing statements and their transactions are preserved in
 * `bank_statements_legacy_gl` and cleared from the live tables, and the `is_reconciled` flags they
 * set are reset, because a flag whose match no longer exists would exclude a ledger line from every
 * future reconciliation with nothing to explain why.
 */
export class ReconciliationRebuild1788700500000 implements MigrationInterface {
  name = 'ReconciliationRebuild1788700500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── preserve, then clear ──────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'bank_statements' AND column_name = 'account_id'
        ) AND EXISTS (SELECT 1 FROM "bank_statements") THEN
          CREATE TABLE IF NOT EXISTS "bank_statements_legacy_gl" AS
            SELECT * FROM "bank_statements";
          CREATE TABLE IF NOT EXISTS "bank_transactions_legacy_gl" AS
            SELECT * FROM "bank_transactions";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      UPDATE "journal_entry_lines" SET "is_reconciled" = false WHERE "is_reconciled" = true
    `);
    await queryRunner.query(`DELETE FROM "bank_transactions"`);
    await queryRunner.query(`DELETE FROM "bank_statements"`);

    // ── journal_entry_lines ───────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        ADD COLUMN IF NOT EXISTS "reconciled_at" TIMESTAMP WITH TIME ZONE
    `);

    // ── bank_statements ───────────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."bank_statements_status_enum_new"
          AS ENUM ('IMPORTING', 'IMPORTED', 'FAILED', 'RECONCILED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "bank_statements"
        DROP CONSTRAINT IF EXISTS "FK_924bd1936b7e0aa3927ec765b41",
        DROP COLUMN IF EXISTS "account_id",
        ALTER COLUMN "status" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "bank_statements"
        ALTER COLUMN "status" TYPE "public"."bank_statements_status_enum_new"
          USING 'IMPORTING'::"public"."bank_statements_status_enum_new"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."bank_statements_status_enum"`);
    await queryRunner.query(`
      ALTER TYPE "public"."bank_statements_status_enum_new"
        RENAME TO "bank_statements_status_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "bank_statements"
        ALTER COLUMN "status" SET DEFAULT 'IMPORTING',
        ADD COLUMN IF NOT EXISTS "bank_account_id" uuid NOT NULL,
        ADD COLUMN IF NOT EXISTS "file_hash" character(64),
        ADD COLUMN IF NOT EXISTS "import_error" text,
        ADD COLUMN IF NOT EXISTS "reconciled_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "reconciled_by_user_id" uuid,
        ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid,
        ALTER COLUMN "file_name" TYPE character varying(255),
        ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE,
        ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "bank_statements"
          ADD CONSTRAINT "FK_8effef620ff28585490eee69593"
          FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bank_statements_org_account"
      ON "bank_statements" ("organization_id", "bank_account_id")
    `);
    // The same file twice loaded every transaction a second time, and both copies were matchable.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bank_statements_file_hash"
      ON "bank_statements" ("organization_id", "bank_account_id", "file_hash")
      WHERE "file_hash" IS NOT NULL AND "status" <> 'FAILED'
    `);

    // ── bank_transactions ─────────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."bank_transactions_status_enum_new"
          AS ENUM ('UNMATCHED', 'MATCHED', 'EXCLUDED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "bank_transactions"
        DROP CONSTRAINT IF EXISTS "FK_285545de48eabf3195f600c1fb6",
        DROP COLUMN IF EXISTS "matched_entry_line_id",
        ALTER COLUMN "status" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "bank_transactions"
        ALTER COLUMN "status" TYPE "public"."bank_transactions_status_enum_new"
          USING 'UNMATCHED'::"public"."bank_transactions_status_enum_new"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."bank_transactions_status_enum"`);
    await queryRunner.query(`
      ALTER TYPE "public"."bank_transactions_status_enum_new"
        RENAME TO "bank_transactions_status_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "bank_transactions"
        ALTER COLUMN "status" SET DEFAULT 'UNMATCHED',
        ALTER COLUMN "description" TYPE character varying(500),
        ADD COLUMN IF NOT EXISTS "reference" character varying(120),
        ADD COLUMN IF NOT EXISTS "match_id" uuid,
        ADD COLUMN IF NOT EXISTS "exclusion_reason" text,
        ADD COLUMN IF NOT EXISTS "source_row" integer
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bank_transactions_statement"
      ON "bank_transactions" ("statement_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bank_transactions_match"
      ON "bank_transactions" ("match_id")
    `);

    // ── reconciliation_matches ────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."reconciliation_matches_origin_enum"
          AS ENUM ('MANUAL', 'RULE', 'AUTOMATIC');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reconciliation_matches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "statement_id" uuid NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "origin" "public"."reconciliation_matches_origin_enum" NOT NULL DEFAULT 'MANUAL',
        "rule_id" uuid,
        "matched_by_user_id" uuid,
        "notes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reconciliation_matches" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reconciliation_match_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "match_id" uuid NOT NULL,
        "journal_entry_line_id" uuid NOT NULL,
        CONSTRAINT "PK_reconciliation_match_lines" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "reconciliation_matches"
          ADD CONSTRAINT "FK_e65f8cfa0ef31889b293f52f50d"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "reconciliation_matches"
          ADD CONSTRAINT "FK_d2cac48af4cc489dac129748ed9"
          FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "reconciliation_match_lines"
          ADD CONSTRAINT "FK_1e1841aa05b75004fac83bd7f2c"
          FOREIGN KEY ("match_id") REFERENCES "reconciliation_matches"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "reconciliation_match_lines"
          ADD CONSTRAINT "FK_88d52be6cdd7194c8a0e4596d8c"
          FOREIGN KEY ("journal_entry_line_id") REFERENCES "journal_entry_lines"("id")
          ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "bank_transactions"
          ADD CONSTRAINT "FK_0acc780f3a908d6f937c36a3506"
          FOREIGN KEY ("match_id") REFERENCES "reconciliation_matches"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    // The load-bearing constraint: a ledger line belongs to at most one match, so the same payment
    // cannot be cleared twice against two statement lines and quietly balance the proof.
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "reconciliation_match_lines"
          ADD CONSTRAINT "UQ_reconciliation_match_lines_line" UNIQUE ("journal_entry_line_id");
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reconciliation_matches_statement"
      ON "reconciliation_matches" ("statement_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reconciliation_match_lines_match"
      ON "reconciliation_match_lines" ("match_id")
    `);

    // ── reconciliation_rules ──────────────────────────────────────────────────
    //
    // The organization column had no foreign key, so a rule could belong to a tenant that no longer
    // exists; the target account likewise. Both are cleaned before the constraint goes on.
    await queryRunner.query(`
      DELETE FROM "reconciliation_rules" r
      WHERE NOT EXISTS (
        SELECT 1 FROM "organizations" o WHERE o."id"::text = r."organization_id"::text
      )
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "reconciliation_rules"
          ALTER COLUMN "organization_id" TYPE uuid USING "organization_id"::uuid;
      EXCEPTION WHEN others THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "reconciliation_rules"
          ALTER COLUMN "target_account_id" TYPE uuid USING "target_account_id"::uuid;
      EXCEPTION WHEN others THEN NULL; END $$;
    `);
    await queryRunner.query(`
      UPDATE "reconciliation_rules" r SET "target_account_id" = NULL
      WHERE "target_account_id" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."id" = r."target_account_id")
    `);

    for (const [from, to] of [
      ['conditionField', 'condition_field'],
      ['conditionOperator', 'condition_operator'],
      ['conditionValue', 'condition_value'],
    ]) {
      await queryRunner.query(`
        DO $$ BEGIN
          ALTER TABLE "reconciliation_rules" RENAME COLUMN "${from}" TO "${to}";
        EXCEPTION WHEN undefined_column THEN NULL; END $$;
      `);
    }

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."reconciliation_rules_condition_field_enum"
          AS ENUM ('DESCRIPTION', 'REFERENCE', 'AMOUNT');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."reconciliation_rules_condition_operator_enum"
          AS ENUM ('CONTAINS', 'EQUALS', 'STARTS_WITH', 'ENDS_WITH');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."reconciliation_rules_direction_enum"
          AS ENUM ('ANY', 'MONEY_IN', 'MONEY_OUT');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."reconciliation_rules_action_enum"
          AS ENUM ('MATCH_EXISTING', 'CREATE_ENTRY');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "reconciliation_rules"
        ALTER COLUMN "condition_field" TYPE "public"."reconciliation_rules_condition_field_enum"
          USING "condition_field"::text::"public"."reconciliation_rules_condition_field_enum",
        ALTER COLUMN "condition_operator" TYPE "public"."reconciliation_rules_condition_operator_enum"
          USING "condition_operator"::text::"public"."reconciliation_rules_condition_operator_enum"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."reconciliation_rules_conditionfield_enum";
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."reconciliation_rules_conditionoperator_enum";
    `);
    await queryRunner.query(`
      ALTER TABLE "reconciliation_rules"
        ALTER COLUMN "name" TYPE character varying(120),
        ALTER COLUMN "condition_value" TYPE character varying(255),
        ALTER COLUMN "target_account_id" DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS "direction" "public"."reconciliation_rules_direction_enum"
          NOT NULL DEFAULT 'ANY',
        ADD COLUMN IF NOT EXISTS "amount_min" numeric(18,2),
        ADD COLUMN IF NOT EXISTS "amount_max" numeric(18,2),
        ADD COLUMN IF NOT EXISTS "action" "public"."reconciliation_rules_action_enum"
          NOT NULL DEFAULT 'MATCH_EXISTING',
        ADD COLUMN IF NOT EXISTS "priority" integer NOT NULL DEFAULT 100,
        ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "reconciliation_rules"
          ADD CONSTRAINT "FK_55043a763dcf26f05c31c2e3b39"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "reconciliation_rules"
          ADD CONSTRAINT "FK_cd4cfbb69b12815cd0969c2ea53"
          FOREIGN KEY ("target_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reconciliation_rules_org"
      ON "reconciliation_rules" ("organization_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_reconciliation_rules_org"`);
    await queryRunner.query(`
      ALTER TABLE "reconciliation_rules"
        DROP CONSTRAINT IF EXISTS "FK_cd4cfbb69b12815cd0969c2ea53",
        DROP CONSTRAINT IF EXISTS "FK_55043a763dcf26f05c31c2e3b39",
        DROP COLUMN IF EXISTS "direction",
        DROP COLUMN IF EXISTS "amount_min",
        DROP COLUMN IF EXISTS "amount_max",
        DROP COLUMN IF EXISTS "action",
        DROP COLUMN IF EXISTS "priority",
        DROP COLUMN IF EXISTS "is_active",
        DROP COLUMN IF EXISTS "created_at",
        DROP COLUMN IF EXISTS "updated_at"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."reconciliation_rules_action_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."reconciliation_rules_direction_enum"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "reconciliation_match_lines"`);
    await queryRunner.query(`
      ALTER TABLE "bank_transactions" DROP CONSTRAINT IF EXISTS "FK_0acc780f3a908d6f937c36a3506"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "reconciliation_matches"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."reconciliation_matches_origin_enum"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bank_transactions_match"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bank_transactions_statement"`);
    await queryRunner.query(`
      ALTER TABLE "bank_transactions"
        DROP COLUMN IF EXISTS "reference",
        DROP COLUMN IF EXISTS "match_id",
        DROP COLUMN IF EXISTS "exclusion_reason",
        DROP COLUMN IF EXISTS "source_row",
        ADD COLUMN IF NOT EXISTS "matched_entry_line_id" uuid
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_bank_statements_file_hash"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bank_statements_org_account"`);
    await queryRunner.query(`
      ALTER TABLE "bank_statements"
        DROP CONSTRAINT IF EXISTS "FK_8effef620ff28585490eee69593",
        DROP COLUMN IF EXISTS "bank_account_id",
        DROP COLUMN IF EXISTS "file_hash",
        DROP COLUMN IF EXISTS "import_error",
        DROP COLUMN IF EXISTS "reconciled_at",
        DROP COLUMN IF EXISTS "reconciled_by_user_id",
        DROP COLUMN IF EXISTS "created_by_user_id",
        ADD COLUMN IF NOT EXISTS "account_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines" DROP COLUMN IF EXISTS "reconciled_at"
    `);
  }
}
