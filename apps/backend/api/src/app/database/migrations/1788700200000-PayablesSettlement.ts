import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supplier payments record what actually happened when the money moved.
 *
 * There was no way to pay a bill through the API at all: `createPaymentBatch` was in the service,
 * exposed by no controller and called by nothing. Had it been reachable it would have paid every
 * selected bill in full — `vendor_payment` held only a bill, a date and an amount, which is the
 * shape of a system that has no other option.
 *
 * The columns added here are the ones a settlement needs: how much left the bank as against how
 * much was applied to the bill, what was withheld from the supplier, what discount was taken, and
 * the realised exchange difference between the rate the bill was booked at and the rate it was paid
 * at. That last one was simply lost before, so a multicurrency payables ledger drifted on every
 * payment with nowhere for the difference to go.
 *
 * `payment_batches` gains a proper tenant foreign key, the reference the bank statement will carry,
 * and a link to the journal entry the run produced, so a payment can be traced to the ledger and
 * reversed as a unit.
 */
export class PayablesSettlement1788700200000 implements MigrationInterface {
  name = 'PayablesSettlement1788700200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── vendor_payment ────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "vendor_payment"
        ADD COLUMN IF NOT EXISTS "amount_paid" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "tax_withheld" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "income_tax_withheld" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "discount" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "exchange_difference" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(18,6)
    `);

    // `amount` was numeric(10,2) — about 99 million, which a Colombian peso or Paraguayan guaraní
    // ledger reaches on an ordinary invoice.
    await queryRunner.query(
      `ALTER TABLE "vendor_payment" ALTER COLUMN "amount" TYPE numeric(18,2)`,
    );

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "vendor_payment" RENAME COLUMN "vendorBillId" TO "vendor_bill_id";
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
    `);

    // The bill reference was `character varying` pointing at a `uuid` primary key — the same
    // mismatch the tenant-integrity work fixed across twenty other tables. A join between them is
    // a type error PostgreSQL refuses, and a row referencing a deleted bill was perfectly storable.
    await queryRunner.query(`
      DELETE FROM "vendor_payment" p
      WHERE NOT EXISTS (SELECT 1 FROM "vendor_bills" b WHERE b."id"::text = p."vendor_bill_id"::text)
    `);
    // Cast only if it is not already a uuid: the migration has to survive a re-run against a
    // database where an earlier attempt got this far.
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "vendor_payment"
          ALTER COLUMN "vendor_bill_id" TYPE uuid USING "vendor_bill_id"::uuid;
      EXCEPTION WHEN others THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "vendor_payment"
          ADD CONSTRAINT "FK_a26a568fe704e6934085ce55bf2"
          FOREIGN KEY ("vendor_bill_id") REFERENCES "vendor_bills"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // A payment with no batch is a payment nothing accounts for.
    await queryRunner.query(
      `DELETE FROM "vendor_payment" WHERE "payment_batch_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendor_payment" ALTER COLUMN "payment_batch_id" SET NOT NULL`,
    );

    // A payment date is a calendar date, not an instant. Stored as a timestamp it shifted month
    // for any tenant west of Greenwich, which is all of them in this product's markets.
    await queryRunner.query(
      `ALTER TABLE "vendor_payment" ALTER COLUMN "date" TYPE date USING "date"::date`,
    );

    await queryRunner.query(`
      UPDATE "vendor_payment" SET "amount_paid" = "amount" WHERE "amount_paid" = 0
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_vendor_payments_bill"
      ON "vendor_payment" ("vendor_bill_id")
    `);

    // ── payment_batches ───────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "payment_batches"
        ADD COLUMN IF NOT EXISTS "reference" character varying(80),
        ADD COLUMN IF NOT EXISTS "journal_entry_id" uuid,
        ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid,
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "payment_batches" RENAME COLUMN "paymentDate" TO "payment_date";
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "payment_batches" ALTER COLUMN "organization_id" TYPE uuid USING "organization_id"::uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "payment_batches" ALTER COLUMN "bank_account_id" TYPE uuid USING "bank_account_id"::uuid
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "payment_batches"
          ADD CONSTRAINT "FK_4d1022146de17011fcb75d166b5"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_batches_org_date"
      ON "payment_batches" ("organization_id", "payment_date")
    `);

    // ── exchange_rate ─────────────────────────────────────────────────────────
    //
    // No uniqueness constraint, so the daily refresh appended a row per currency per run and the
    // lookups — which order by date and take the first — picked among same-day duplicates
    // arbitrarily. The same invoice could convert two different ways on two reads.
    await queryRunner.query(
      `ALTER TABLE "exchange_rate" ALTER COLUMN "date" TYPE date USING "date"::date`,
    );
    await queryRunner.query(
      `ALTER TABLE "exchange_rate" ALTER COLUMN "rate" TYPE numeric(18,6)`,
    );
    // ISO 4217 is three letters. Unbounded `character varying` let 'usd ' and 'USD' coexist as
    // different currencies, which is a lookup that silently finds no rate.
    await queryRunner.query(`
      UPDATE "exchange_rate"
      SET "fromCurrency" = UPPER(TRIM("fromCurrency")),
          "toCurrency" = UPPER(TRIM("toCurrency"))
    `);
    await queryRunner.query(
      `ALTER TABLE "exchange_rate" ALTER COLUMN "fromCurrency" TYPE character varying(3)`,
    );
    await queryRunner.query(
      `ALTER TABLE "exchange_rate" ALTER COLUMN "toCurrency" TYPE character varying(3)`,
    );
    await queryRunner.query(`
      DELETE FROM "exchange_rate" a
      USING "exchange_rate" b
      WHERE a."fromCurrency" = b."fromCurrency"
        AND a."toCurrency" = b."toCurrency"
        AND a."date" = b."date"
        AND a."id" < b."id"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_exchange_rate_pair_date"
      ON "exchange_rate" ("fromCurrency", "toCurrency", "date")
    `);

    // VOID joins the batch status enum so a payment run can be reversed rather than deleted.
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "public"."payment_batches_status_enum" ADD VALUE IF NOT EXISTS 'VOID';
      EXCEPTION WHEN undefined_object THEN NULL; END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_exchange_rate_pair_date"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_batches_org_date"`);
    await queryRunner.query(
      `ALTER TABLE "payment_batches" DROP CONSTRAINT IF EXISTS "FK_4d1022146de17011fcb75d166b5"`,
    );
    await queryRunner.query(`
      ALTER TABLE "payment_batches"
        DROP COLUMN IF EXISTS "reference",
        DROP COLUMN IF EXISTS "journal_entry_id",
        DROP COLUMN IF EXISTS "created_by_user_id",
        DROP COLUMN IF EXISTS "created_at"
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "payment_batches" RENAME COLUMN "payment_date" TO "paymentDate";
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_vendor_payments_bill"`);
    await queryRunner.query(`
      ALTER TABLE "vendor_payment"
        DROP COLUMN IF EXISTS "amount_paid",
        DROP COLUMN IF EXISTS "tax_withheld",
        DROP COLUMN IF EXISTS "income_tax_withheld",
        DROP COLUMN IF EXISTS "discount",
        DROP COLUMN IF EXISTS "exchange_difference",
        DROP COLUMN IF EXISTS "exchange_rate"
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "vendor_payment" RENAME COLUMN "vendor_bill_id" TO "vendorBillId";
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "vendor_payment" RENAME COLUMN "payment_batch_id" TO "paymentBatchId";
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
    `);
  }
}
