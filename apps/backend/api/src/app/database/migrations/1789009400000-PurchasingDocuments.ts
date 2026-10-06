import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Purchasing documents that existed only as side effects become documents.
 *
 *   - `purchase_order_receipts` — a goods receipt was a row with no number, no state and no way to
 *     undo it: receiving the wrong quantity was permanent. It gains a number (`GR-2026-000001`), a
 *     status, and the void trail (reason, when, who, the reversing entry).
 *   - `payment_batches` — a payment to suppliers had no number a person could quote and could not be
 *     voided, although its status enum already had `VOID`. It gains both.
 *   - `vendor_debit_note` — the note pointed at its bill through an untyped varchar with no foreign
 *     key, dated itself with the moment it was typed, kept no counterpart account, and had no
 *     number, supplier document (NCF), tax portion or branch. All of those are added; the bill
 *     reference becomes a real uuid foreign key.
 *
 * Existing rows are numbered in the order they happened, per company and year, and the number
 * series are seeded past them so the next document continues the sequence.
 */
const SCOPE = {
  GOODS_RECEIPT: '00000000-0000-4000-8000-000000000006',
  VENDOR_PAYMENT: '00000000-0000-4000-8000-000000000007',
  VENDOR_DEBIT_NOTE: '00000000-0000-4000-8000-000000000008',
} as const;

export class PurchasingDocuments1789009400000 implements MigrationInterface {
  name = 'PurchasingDocuments1789009400000';

  public async up(q: QueryRunner): Promise<void> {
    // ── Goods receipts ────────────────────────────────────────────────────────────────────────
    await q.query(`
      ALTER TABLE "purchase_order_receipts"
        ADD COLUMN "number" varchar(40),
        ADD COLUMN "status" varchar(16) NOT NULL DEFAULT 'POSTED',
        ADD COLUMN "void_reason" text,
        ADD COLUMN "voided_at" timestamptz,
        ADD COLUMN "voided_by_user_id" uuid,
        ADD COLUMN "reversal_journal_entry_id" uuid
    `);
    await q.query(`
      ALTER TABLE "purchase_order_receipts"
        ADD CONSTRAINT "CHK_purchase_order_receipts_status" CHECK ("status" IN ('POSTED', 'VOID'))
    `);
    await this.number(q, 'purchase_order_receipts', `"received_at"`, 'GR', SCOPE.GOODS_RECEIPT);
    await q.query(`ALTER TABLE "purchase_order_receipts" ALTER COLUMN "number" SET NOT NULL`);
    await q.query(`
      CREATE UNIQUE INDEX "UQ_purchase_order_receipts_org_number"
        ON "purchase_order_receipts" ("organization_id", "number")
    `);
    await q.query(`
      CREATE INDEX "IDX_purchase_order_receipts_org_date"
        ON "purchase_order_receipts" ("organization_id", "received_at")
    `);

    // ── Vendor payments ───────────────────────────────────────────────────────────────────────
    await q.query(`
      ALTER TABLE "payment_batches"
        ADD COLUMN "number" varchar(40),
        ADD COLUMN "void_reason" text,
        ADD COLUMN "voided_at" timestamptz,
        ADD COLUMN "voided_by_user_id" uuid,
        ADD COLUMN "reversal_journal_entry_id" uuid
    `);
    await this.number(q, 'payment_batches', `"payment_date"`, 'PAY', SCOPE.VENDOR_PAYMENT);
    // `amount_paid` is documented as what left the bank in the bank account's currency, but was
    // written in the bill's. Where the two differ the account is in the base currency (the only
    // other combination payBills accepts), so the bank amount is the bill amount at the rate the
    // payment recorded.
    await q.query(`
      UPDATE "vendor_payment" p
         SET "amount_paid" = ROUND(p."amount_paid" * p."exchange_rate", 2)
        FROM "payment_batches" b, "bank_accounts" a, "vendor_bills" v
       WHERE b."id" = p."payment_batch_id"
         AND a."id" = b."bank_account_id"
         AND v."id" = p."vendor_bill_id"
         AND a."currency_code" <> v."currency_code"
         AND p."exchange_rate" IS NOT NULL
    `);
    await q.query(`ALTER TABLE "payment_batches" ALTER COLUMN "number" SET NOT NULL`);
    await q.query(`
      CREATE UNIQUE INDEX "UQ_payment_batches_org_number" ON "payment_batches" ("organization_id", "number")
    `);

    // ── Vendor debit notes ────────────────────────────────────────────────────────────────────
    await q.query(`ALTER TABLE "vendor_debit_note" RENAME COLUMN "vendorBillId" TO "vendor_bill_id"`);
    await q.query(`
      ALTER TABLE "vendor_debit_note"
        ALTER COLUMN "vendor_bill_id" TYPE uuid USING "vendor_bill_id"::uuid,
        ALTER COLUMN "amount" TYPE numeric(18,2),
        ALTER COLUMN "date" DROP DEFAULT,
        ALTER COLUMN "reason" TYPE varchar(500),
        ADD COLUMN "number" varchar(40),
        ADD COLUMN "ncf" varchar(19),
        ADD COLUMN "tax_amount" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN "expense_account_id" uuid,
        ADD COLUMN "branch_id" uuid,
        ADD COLUMN "created_by_user_id" uuid,
        ADD COLUMN "created_at" timestamptz NOT NULL DEFAULT now()
    `);
    await q.query(`
      ALTER TABLE "vendor_debit_note"
        ADD CONSTRAINT "FK_vendor_debit_note_vendor_bill"
        FOREIGN KEY ("vendor_bill_id") REFERENCES "vendor_bills"("id") ON DELETE NO ACTION
    `);
    await q.query(`
      ALTER TABLE "vendor_debit_note"
        ADD CONSTRAINT "FK_vendor_debit_note_branch"
        FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION
    `);
    await q.query(`
      ALTER TABLE "vendor_debit_note"
        ADD CONSTRAINT "CHK_vendor_debit_note_tax" CHECK ("tax_amount" >= 0 AND "tax_amount" < "amount")
    `);
    // Issued where the bill was: the branch a restricted person must be able to see to act on it.
    await q.query(`
      UPDATE "vendor_debit_note" n SET "branch_id" = b."branch_id"
        FROM "vendor_bills" b WHERE b."id" = n."vendor_bill_id"
    `);
    await this.number(q, 'vendor_debit_note', `"date"`, 'ND', SCOPE.VENDOR_DEBIT_NOTE);
    await q.query(`ALTER TABLE "vendor_debit_note" ALTER COLUMN "number" SET NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX "UQ_vendor_debit_note_org_number" ON "vendor_debit_note" ("organization_id", "number")`);
    await q.query(`CREATE INDEX "IDX_vendor_debit_note_bill" ON "vendor_debit_note" ("vendor_bill_id")`);
    await q.query(`CREATE INDEX "IDX_vendor_debit_note_org_date" ON "vendor_debit_note" ("organization_id", "date")`);
    await q.query(`CREATE INDEX "IDX_vendor_debit_note_org_branch" ON "vendor_debit_note" ("organization_id", "branch_id")`);
  }

  /**
   * Numbers the rows already there in the order they happened — per company and year of `dateColumn`
   * — and seeds the series so the next document allocated by `allocateDocumentNumber` follows them.
   * Runs as the migration role, which bypasses row-level security, so it sees every tenant.
   */
  private async number(q: QueryRunner, table: string, dateColumn: string, prefix: string, scope: string): Promise<void> {
    await q.query(`
      WITH ordered AS (
        SELECT "id", "organization_id",
               EXTRACT(YEAR FROM ${dateColumn})::int AS "year",
               ROW_NUMBER() OVER (
                 PARTITION BY "organization_id", EXTRACT(YEAR FROM ${dateColumn})
                 ORDER BY ${dateColumn}, "id"
               ) AS "n"
          FROM "${table}"
      )
      UPDATE "${table}" t
         SET "number" = '${prefix}-' || o."year" || '-' || LPAD(o."n"::text, 6, '0')
        FROM ordered o
       WHERE o."id" = t."id"
    `);
    await q.query(
      `
      INSERT INTO "journal_entry_sequences" ("organization_id", "journal_id", "year", "last_number")
      SELECT "organization_id", $1::uuid, EXTRACT(YEAR FROM ${dateColumn})::int, COUNT(*)
        FROM "${table}"
       GROUP BY "organization_id", EXTRACT(YEAR FROM ${dateColumn})
      ON CONFLICT ("organization_id", "journal_id", "year") DO UPDATE
        SET "last_number" = GREATEST("journal_entry_sequences"."last_number", EXCLUDED."last_number")
    `,
      [scope],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM "journal_entry_sequences" WHERE "journal_id" IN ($1, $2, $3)`, [
      SCOPE.GOODS_RECEIPT,
      SCOPE.VENDOR_PAYMENT,
      SCOPE.VENDOR_DEBIT_NOTE,
    ]);

    await q.query(`DROP INDEX IF EXISTS "IDX_vendor_debit_note_org_branch"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_vendor_debit_note_org_date"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_vendor_debit_note_bill"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_vendor_debit_note_org_number"`);
    await q.query(`ALTER TABLE "vendor_debit_note" DROP CONSTRAINT IF EXISTS "CHK_vendor_debit_note_tax"`);
    await q.query(`ALTER TABLE "vendor_debit_note" DROP CONSTRAINT IF EXISTS "FK_vendor_debit_note_branch"`);
    await q.query(`ALTER TABLE "vendor_debit_note" DROP CONSTRAINT IF EXISTS "FK_vendor_debit_note_vendor_bill"`);
    await q.query(`
      ALTER TABLE "vendor_debit_note"
        DROP COLUMN "created_at",
        DROP COLUMN "created_by_user_id",
        DROP COLUMN "branch_id",
        DROP COLUMN "expense_account_id",
        DROP COLUMN "tax_amount",
        DROP COLUMN "ncf",
        DROP COLUMN "number",
        ALTER COLUMN "reason" TYPE varchar,
        ALTER COLUMN "date" SET DEFAULT now(),
        ALTER COLUMN "amount" TYPE numeric(10,2),
        ALTER COLUMN "vendor_bill_id" TYPE varchar USING "vendor_bill_id"::text
    `);
    await q.query(`ALTER TABLE "vendor_debit_note" RENAME COLUMN "vendor_bill_id" TO "vendorBillId"`);

    await q.query(`
      UPDATE "vendor_payment" p
         SET "amount_paid" = ROUND(p."amount_paid" / p."exchange_rate", 2)
        FROM "payment_batches" b, "bank_accounts" a, "vendor_bills" v
       WHERE b."id" = p."payment_batch_id"
         AND a."id" = b."bank_account_id"
         AND v."id" = p."vendor_bill_id"
         AND a."currency_code" <> v."currency_code"
         AND p."exchange_rate" IS NOT NULL AND p."exchange_rate" <> 0
    `);
    await q.query(`DROP INDEX IF EXISTS "UQ_payment_batches_org_number"`);
    await q.query(`
      ALTER TABLE "payment_batches"
        DROP COLUMN "reversal_journal_entry_id",
        DROP COLUMN "voided_by_user_id",
        DROP COLUMN "voided_at",
        DROP COLUMN "void_reason",
        DROP COLUMN "number"
    `);

    await q.query(`DROP INDEX IF EXISTS "IDX_purchase_order_receipts_org_date"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_purchase_order_receipts_org_number"`);
    await q.query(`ALTER TABLE "purchase_order_receipts" DROP CONSTRAINT IF EXISTS "CHK_purchase_order_receipts_status"`);
    await q.query(`
      ALTER TABLE "purchase_order_receipts"
        DROP COLUMN "reversal_journal_entry_id",
        DROP COLUMN "voided_by_user_id",
        DROP COLUMN "voided_at",
        DROP COLUMN "void_reason",
        DROP COLUMN "status",
        DROP COLUMN "number"
    `);
  }
}
