import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The till's sale becomes a fiscal document.
 *
 * A sale rung at the point of sale used to produce a ticket and nothing else: no e-NCF, no entry in
 * the ledger, no line in the 607 and nothing transmitted to the DGII. In the Dominican Republic that
 * is a sale without a comprobante. Each sale now issues an invoice (E32 to the final consumer, E31
 * to a buyer who gives an RNC or cédula), settles it with receipts into the till's cash and card
 * accounts, and keeps the links here so the ticket can print the e-NCF, security code and QR, and so
 * a void can issue the credit note (E34) that cancels it.
 *
 * `pos_settings` says which treasury accounts the till's takings land in, and whether the company
 * issues a fiscal document per sale (required in the DR; optional elsewhere).
 */
export class PosFiscalDocuments1789260000000 implements MigrationInterface {
  name = 'PosFiscalDocuments1789260000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "fiscal_number" varchar(19) NULL`);
    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "fiscal_document_type" varchar(8) NULL`);
    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "customer_id" uuid NULL`);
    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "customer_tax_id" varchar(20) NULL`);
    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "receipt_ids" jsonb NOT NULL DEFAULT '[]'`);
    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "credit_note_id" uuid NULL`);
    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "captured_at" timestamptz NULL`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pos_sales_org_invoice" ON "pos_sales" ("organization_id", "invoiceId") WHERE "invoiceId" IS NOT NULL`,
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "pos_settings" (
        "organization_id" uuid NOT NULL,
        "fiscal_mode" varchar(16) NOT NULL DEFAULT 'AUTO',
        "cash_bank_account_id" uuid NULL,
        "card_bank_account_id" uuid NULL,
        "transfer_bank_account_id" uuid NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pos_settings" PRIMARY KEY ("organization_id"),
        CONSTRAINT "CHK_pos_settings_fiscal_mode" CHECK ("fiscal_mode" IN ('AUTO', 'REQUIRED', 'OFF')),
        CONSTRAINT "FK_pos_settings_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
        -- The treasury accounts are validated by the service: a foreign key into treasury's table
        -- would tie Sales to how Finance lays out its rows (module-boundaries.config.mjs).
      )
    `);
    await q.query(`ALTER TABLE "pos_settings" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "pos_settings" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "pos_settings"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "pos_settings"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "pos_settings"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_pos_sales_org_invoice"`);
    for (const column of [
      'captured_at',
      'credit_note_id',
      'receipt_ids',
      'customer_tax_id',
      'customer_id',
      'fiscal_document_type',
      'fiscal_number',
    ]) {
      await q.query(`ALTER TABLE "pos_sales" DROP COLUMN IF EXISTS "${column}"`);
    }
  }
}
