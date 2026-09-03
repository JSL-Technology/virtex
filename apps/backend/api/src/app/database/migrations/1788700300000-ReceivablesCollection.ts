import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer receipts become a document, not a bare amount.
 *
 * `customer_payments` held organization, customer, date, bank account, reference, total and lines —
 * with the tenant, customer and bank account as unconstrained `character varying` columns carrying
 * no foreign key, no uuid type and no index, so a receipt could reference a customer that had been
 * deleted, or belong to no tenant at all.
 *
 * What it could not express was the more expensive problem. No currency, so a collection against a
 * foreign-currency invoice recorded the wrong figure and never recognised the realised exchange
 * difference. No withholding, so a receipt net of the tax a customer withholds — routine across the
 * region and mandatory in most of it — under-relieved the invoice and left the balance permanently
 * short. No unapplied amount, so a customer advance or an overpayment could not be recorded at all:
 * the total had to equal the sum applied to invoices that already existed. And no status, so a
 * bounced cheque could not be reversed.
 *
 * `customer_payment_lines` carried a duplicate `invoiceId`/`invoice_id` pair — one a
 * `character varying` holding the value, the other a nullable uuid foreign key that nothing ever
 * populated.
 */
export class ReceivablesCollection1788700300000 implements MigrationInterface {
  name = 'ReceivablesCollection1788700300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."customer_payments_status_enum" AS ENUM ('POSTED', 'VOID');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."customer_payments_payment_method_enum"
          AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // ── customer_payments ─────────────────────────────────────────────────────
    for (const [from, to] of [
      ['organizationId', 'organization_id'],
      ['customerId', 'customer_id'],
      ['paymentDate', 'payment_date'],
      ['bankAccountId', 'bank_account_id'],
      ['totalAmount', 'total_amount'],
      ['createdAt', 'created_at'],
    ]) {
      await queryRunner.query(`
        DO $$ BEGIN
          ALTER TABLE "customer_payments" RENAME COLUMN "${from}" TO "${to}";
        EXCEPTION WHEN undefined_column THEN NULL; END $$;
      `);
    }

    // Orphans first: the tenant and customer columns had no foreign key, so rows pointing at
    // deleted parents were perfectly storable and would block the cast.
    await queryRunner.query(`
      DELETE FROM "customer_payments" p
      WHERE NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id"::text = p."organization_id"::text)
         OR NOT EXISTS (SELECT 1 FROM "customers" c WHERE c."id"::text = p."customer_id"::text)
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "customer_payments"
          ALTER COLUMN "organization_id" TYPE uuid USING "organization_id"::uuid,
          ALTER COLUMN "customer_id" TYPE uuid USING "customer_id"::uuid,
          ALTER COLUMN "bank_account_id" TYPE uuid USING "bank_account_id"::uuid;
      EXCEPTION WHEN others THEN NULL; END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "customer_payments"
        ALTER COLUMN "total_amount" TYPE numeric(18,2),
        ALTER COLUMN "reference" DROP NOT NULL,
        ALTER COLUMN "reference" TYPE character varying(120),
        ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(`
      ALTER TABLE "customer_payments"
        ADD COLUMN IF NOT EXISTS "receipt_number" character varying(40),
        ADD COLUMN IF NOT EXISTS "currency_code" character varying(3) NOT NULL DEFAULT 'USD',
        ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(18,6) NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "unapplied_amount" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "status" "public"."customer_payments_status_enum" NOT NULL DEFAULT 'POSTED',
        ADD COLUMN IF NOT EXISTS "payment_method" "public"."customer_payments_payment_method_enum" NOT NULL DEFAULT 'BANK_TRANSFER',
        ADD COLUMN IF NOT EXISTS "journal_entry_id" uuid,
        ADD COLUMN IF NOT EXISTS "reversal_journal_entry_id" uuid,
        ADD COLUMN IF NOT EXISTS "void_reason" text,
        ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "customer_payments"
          ADD CONSTRAINT "FK_355a4cc9a441a5eae19bd299316"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "customer_payments"
          ADD CONSTRAINT "FK_dcd8ce2a4a8587ee8a1d6985e8b"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_payments_org_date"
      ON "customer_payments" ("organization_id", "payment_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_payments_customer"
      ON "customer_payments" ("customer_id")
    `);

    // ── customer_payment_lines ────────────────────────────────────────────────
    //
    // Two columns for one relationship: `invoiceId` held the value as text, `invoice_id` was a
    // nullable uuid foreign key nothing populated. Consolidate onto the typed one.
    await queryRunner.query(`
      DO $$ BEGIN
      UPDATE "customer_payment_lines"
      SET "invoice_id" = "invoiceId"::uuid
      WHERE "invoice_id" IS NULL AND "invoiceId" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "invoices" i WHERE i."id"::text = "invoiceId"::text);
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
    `);
    await queryRunner.query(
      `DELETE FROM "customer_payment_lines" WHERE "invoice_id" IS NULL OR "payment_id" IS NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "customer_payment_lines"
        DROP COLUMN IF EXISTS "invoiceId"
    `);
    await queryRunner.query(`
      ALTER TABLE "customer_payment_lines"
        ALTER COLUMN "invoice_id" SET NOT NULL,
        ALTER COLUMN "payment_id" SET NOT NULL,
        ALTER COLUMN "amount" TYPE numeric(18,2),
        ADD COLUMN IF NOT EXISTS "tax_withheld" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "income_tax_withheld" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "discount" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "exchange_difference" numeric(18,2) NOT NULL DEFAULT 0
    `);
    // The line-level foreign keys predate this change but were created without ON DELETE CASCADE,
    // so a deleted receipt or invoice left its lines behind.
    await queryRunner.query(`
      ALTER TABLE "customer_payment_lines"
        DROP CONSTRAINT IF EXISTS "FK_0d7cabf97dac158ac1074be1267",
        DROP CONSTRAINT IF EXISTS "FK_ef9d32e9fc160ea298a0d2f8369"
    `);
    await queryRunner.query(`
      ALTER TABLE "customer_payment_lines"
        ADD CONSTRAINT "FK_0d7cabf97dac158ac1074be1267"
          FOREIGN KEY ("payment_id") REFERENCES "customer_payments"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "FK_ef9d32e9fc160ea298a0d2f8369"
          FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_payment_lines_invoice"
      ON "customer_payment_lines" ("invoice_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customer_payment_lines_invoice"`);
    await queryRunner.query(`
      ALTER TABLE "customer_payment_lines"
        DROP COLUMN IF EXISTS "tax_withheld",
        DROP COLUMN IF EXISTS "income_tax_withheld",
        DROP COLUMN IF EXISTS "discount",
        DROP COLUMN IF EXISTS "exchange_difference",
        ADD COLUMN IF NOT EXISTS "invoiceId" character varying
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customer_payments_customer"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customer_payments_org_date"`);
    await queryRunner.query(
      `ALTER TABLE "customer_payments" DROP CONSTRAINT IF EXISTS "FK_dcd8ce2a4a8587ee8a1d6985e8b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_payments" DROP CONSTRAINT IF EXISTS "FK_355a4cc9a441a5eae19bd299316"`,
    );
    await queryRunner.query(`
      ALTER TABLE "customer_payments"
        DROP COLUMN IF EXISTS "receipt_number",
        DROP COLUMN IF EXISTS "currency_code",
        DROP COLUMN IF EXISTS "exchange_rate",
        DROP COLUMN IF EXISTS "unapplied_amount",
        DROP COLUMN IF EXISTS "status",
        DROP COLUMN IF EXISTS "payment_method",
        DROP COLUMN IF EXISTS "journal_entry_id",
        DROP COLUMN IF EXISTS "reversal_journal_entry_id",
        DROP COLUMN IF EXISTS "void_reason",
        DROP COLUMN IF EXISTS "voided_at",
        DROP COLUMN IF EXISTS "created_by_user_id"
    `);
    for (const [from, to] of [
      ['organization_id', 'organizationId'],
      ['customer_id', 'customerId'],
      ['payment_date', 'paymentDate'],
      ['bank_account_id', 'bankAccountId'],
      ['total_amount', 'totalAmount'],
      ['created_at', 'createdAt'],
    ]) {
      await queryRunner.query(`
        DO $$ BEGIN
          ALTER TABLE "customer_payments" RENAME COLUMN "${from}" TO "${to}";
        EXCEPTION WHEN undefined_column THEN NULL; END $$;
      `);
    }
  }
}
