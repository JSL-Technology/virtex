import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Treasury gets the thing it was missing: a bank account.
 *
 * `bank_transfers` pointed at two **chart-of-accounts** rows. There was no record of a bank, an
 * account number, an account currency or an opening balance anywhere in the schema, so:
 *
 * - two accounts at different banks sharing a control account produced indistinguishable rows;
 * - a bank statement had nowhere to belong, which is why reconciliation took a raw GL account id;
 * - a USD account held by a DOP-based tenant could not be told from a DOP one;
 * - there was no cash position to report, by account or at all.
 *
 * The transfer row could not describe a cross-currency movement either: one `amount`, no fee, and
 * no link to the entry it produced — the transfer and its accounting were unrelated records.
 *
 * Existing transfers cannot be migrated onto bank accounts, because the information that would
 * identify one (which bank, which account number) was never captured. They are preserved in
 * `bank_transfers_legacy_gl` so nothing is lost, and the live table starts clean.
 */
export class TreasuryBankAccounts1788700400000 implements MigrationInterface {
  name = 'TreasuryBankAccounts1788700400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN IF NOT EXISTS "default_bank_fees_account_id" uuid
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."bank_accounts_account_type_enum"
          AS ENUM ('CHECKING', 'SAVINGS', 'CASH', 'CREDIT_CARD');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bank_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "bank_name" character varying(120),
        "account_number" character varying(60),
        "iban" character varying(34),
        "swift_bic" character varying(11),
        "account_type" "public"."bank_accounts_account_type_enum" NOT NULL DEFAULT 'CHECKING',
        "currency_code" character varying(3) NOT NULL,
        "gl_account_id" uuid NOT NULL,
        "opening_balance" numeric(18,2) NOT NULL DEFAULT 0,
        "opening_date" date,
        "is_active" boolean NOT NULL DEFAULT true,
        "notes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bank_accounts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "bank_accounts"
          ADD CONSTRAINT "FK_cc20105b139589c697648c925c3"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "bank_accounts"
          ADD CONSTRAINT "FK_de06f95dbf7464474b74268527d"
          FOREIGN KEY ("gl_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bank_accounts_org"
      ON "bank_accounts" ("organization_id")
    `);
    // An account number identifies an account at a bank; the same one twice inside one tenant is a
    // duplicate record, and two statements would then reconcile against each other's transactions.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bank_accounts_org_number"
      ON "bank_accounts" ("organization_id", "account_number")
      WHERE "account_number" IS NOT NULL
    `);

    // ── bank_transfers ────────────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'bank_transfers' AND column_name = 'from_account_id'
        ) AND EXISTS (SELECT 1 FROM "bank_transfers") THEN
          CREATE TABLE IF NOT EXISTS "bank_transfers_legacy_gl" AS
            SELECT * FROM "bank_transfers";
        END IF;
      END $$;
    `);
    await queryRunner.query(`DELETE FROM "bank_transfers"`);

    await queryRunner.query(`
      ALTER TABLE "bank_transfers"
        DROP COLUMN IF EXISTS "from_account_id",
        DROP COLUMN IF EXISTS "to_account_id",
        ADD COLUMN IF NOT EXISTS "from_bank_account_id" uuid NOT NULL,
        ADD COLUMN IF NOT EXISTS "to_bank_account_id" uuid NOT NULL,
        ADD COLUMN IF NOT EXISTS "amount_received" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "fee" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "journal_entry_id" uuid,
        ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "bank_transfers"
          ALTER COLUMN "organization_id" TYPE uuid USING "organization_id"::uuid;
      EXCEPTION WHEN others THEN NULL; END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "bank_transfers"
        ALTER COLUMN "amount" TYPE numeric(18,2),
        ALTER COLUMN "amount_received" DROP DEFAULT,
        ALTER COLUMN "description" TYPE character varying(500),
        ALTER COLUMN "reference" TYPE character varying(80),
        ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
    `);

    for (const [name, column, target, onDelete] of [
      ['FK_5fa858ac77726a79056acab2961', 'from_bank_account_id', 'bank_accounts', 'RESTRICT'],
      ['FK_9d9293f1e8c20c255303163f65b', 'to_bank_account_id', 'bank_accounts', 'RESTRICT'],
      ['FK_e1a50ea917250a820ce845c7511', 'journal_entry_id', 'journal_entries', 'SET NULL'],
    ]) {
      await queryRunner.query(`
        DO $$ BEGIN
          ALTER TABLE "bank_transfers"
            ADD CONSTRAINT "${name}"
            FOREIGN KEY ("${column}") REFERENCES "${target}"("id") ON DELETE ${onDelete};
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      `);
    }
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bank_transfers_org_date"
      ON "bank_transfers" ("organization_id", "date")
    `);

    // ── payments point at a bank account, not a control account ───────────────
    //
    // `payment_batches.bank_account_id` and `customer_payments.bank_account_id` held a
    // chart-of-accounts id under a name that says otherwise, with no foreign key. Four bank
    // accounts sharing one control account produced four indistinguishable payments, which is
    // precisely the information a bank reconciliation needs and could never recover.
    //
    // The old values are ids from a different table; they cannot be translated, because which of
    // the accounts posting to that control account the funds actually moved through was never
    // recorded. Rows carrying one are cleared rather than silently reinterpreted.
    await queryRunner.query(`
      DELETE FROM "payment_batches"
      WHERE NOT EXISTS (
        SELECT 1 FROM "bank_accounts" b WHERE b."id" = "payment_batches"."bank_account_id"
      )
    `);
    await queryRunner.query(`
      DELETE FROM "customer_payments"
      WHERE NOT EXISTS (
        SELECT 1 FROM "bank_accounts" b WHERE b."id" = "customer_payments"."bank_account_id"
      )
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "payment_batches"
          ADD CONSTRAINT "FK_8c5be41fb23d249f227278cb153"
          FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "customer_payments"
          ADD CONSTRAINT "FK_b099ff465c3b0c21ba7e47540d2"
          FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_payments"
        DROP CONSTRAINT IF EXISTS "FK_b099ff465c3b0c21ba7e47540d2"
    `);
    await queryRunner.query(`
      ALTER TABLE "payment_batches" DROP CONSTRAINT IF EXISTS "FK_8c5be41fb23d249f227278cb153"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bank_transfers_org_date"`);
    await queryRunner.query(`
      ALTER TABLE "bank_transfers"
        DROP CONSTRAINT IF EXISTS "FK_5fa858ac77726a79056acab2961",
        DROP CONSTRAINT IF EXISTS "FK_9d9293f1e8c20c255303163f65b",
        DROP CONSTRAINT IF EXISTS "FK_e1a50ea917250a820ce845c7511",
        DROP COLUMN IF EXISTS "from_bank_account_id",
        DROP COLUMN IF EXISTS "to_bank_account_id",
        DROP COLUMN IF EXISTS "amount_received",
        DROP COLUMN IF EXISTS "fee",
        DROP COLUMN IF EXISTS "journal_entry_id",
        DROP COLUMN IF EXISTS "created_by_user_id",
        ADD COLUMN IF NOT EXISTS "from_account_id" uuid,
        ADD COLUMN IF NOT EXISTS "to_account_id" uuid
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_bank_accounts_org_number"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bank_accounts_org"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bank_accounts"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."bank_accounts_account_type_enum"`);
    await queryRunner.query(`
      ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "default_bank_fees_account_id"
    `);
  }
}
