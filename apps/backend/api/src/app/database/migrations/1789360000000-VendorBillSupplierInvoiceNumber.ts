import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The supplier's own invoice number, unique per supplier among live bills (audit 2026-10-31, AP-03).
 *
 * Only the Dominican NCF identified a supplier document, so the same invoice could be recorded and
 * paid twice in every other market. Existing bills have no number to backfill: the column starts
 * empty and the index ignores them.
 */
export class VendorBillSupplierInvoiceNumber1789360000000 implements MigrationInterface {
  name = 'VendorBillSupplierInvoiceNumber1789360000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "supplier_invoice_number" character varying(60)`);
    await q.query(`ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "supplier_invoice_key" character varying(60)`);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_vendor_bills_supplier_invoice"
        ON "vendor_bills" ("organization_id", "vendor_id", "supplier_invoice_key")
        WHERE "supplier_invoice_key" IS NOT NULL AND "status" NOT IN ('VOID', 'REJECTED')
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_vendor_bills_supplier_invoice"`);
    await q.query(`ALTER TABLE "vendor_bills" DROP COLUMN IF EXISTS "supplier_invoice_key"`);
    await q.query(`ALTER TABLE "vendor_bills" DROP COLUMN IF EXISTS "supplier_invoice_number"`);
  }
}
