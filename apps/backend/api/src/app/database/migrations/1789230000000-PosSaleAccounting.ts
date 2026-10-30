import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Point-of-sale tickets reach the books and the tax authority (QA R3-C02).
 *
 * A till sale moved stock and nothing else: no revenue, no output tax, no cash and no cost of sale
 * were ever posted, and no comprobante fiscal was drawn, so the 607, the income statement and the
 * inventory account all ignored what the tills sold. A sale now posts its entries in the same
 * transaction that moves its stock, and keeps their ids here so a void can reverse exactly them.
 *
 *  - `journal_entry_id` / `cost_journal_entry_id`: the revenue and cost-of-sale entries.
 *  - `cost_of_sale`: what the goods cost when they left, as the kardex valued them.
 *  - `fiscal_number` / `fiscal_document_type`: the comprobante (B02 in the Dominican Republic)
 *    drawn from the company's authorised range, when it has one in force.
 */
export class PosSaleAccounting1789230000000 implements MigrationInterface {
  name = 'PosSaleAccounting1789230000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "pos_sales"
        ADD COLUMN IF NOT EXISTS "journal_entry_id" uuid,
        ADD COLUMN IF NOT EXISTS "cost_journal_entry_id" uuid,
        ADD COLUMN IF NOT EXISTS "cost_of_sale" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "fiscal_number" varchar(19),
        ADD COLUMN IF NOT EXISTS "fiscal_document_type" varchar(8)
    `);
    // A comprobante is issued once per company, whichever document carries it.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pos_sales_org_fiscal_number"
        ON "pos_sales" ("organization_id", "fiscal_number") WHERE "fiscal_number" IS NOT NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_pos_sales_org_fiscal_number"`);
    await q.query(`
      ALTER TABLE "pos_sales"
        DROP COLUMN IF EXISTS "fiscal_document_type",
        DROP COLUMN IF EXISTS "fiscal_number",
        DROP COLUMN IF EXISTS "cost_of_sale",
        DROP COLUMN IF EXISTS "cost_journal_entry_id",
        DROP COLUMN IF EXISTS "journal_entry_id"
    `);
  }
}
