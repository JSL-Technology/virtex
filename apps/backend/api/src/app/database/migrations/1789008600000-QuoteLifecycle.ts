import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quotes as a document with a lifecycle (QA M-09: «Nueva cotización» led to «módulo en
 * construcción»; the API could create a quote and convert an accepted one, and nothing could make
 * one accepted).
 *
 * - The number is unique per tenant, not across the platform.
 * - Tax, discounts and notes, computed by the invoice engine, so the quoted total is the invoiced one.
 * - Fractional quantities and six-decimal prices, as on an invoice line; lines keep their order.
 * - When it was sent, accepted or rejected, why, and the invoice it became; CANCELLED for a quote
 *   withdrawn before the customer answered.
 */
export class QuoteLifecycle1789008600000 implements MigrationInterface {
  name = 'QuoteLifecycle1789008600000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TYPE "quotes_status_enum" ADD VALUE IF NOT EXISTS 'CANCELLED'`);

    await q.query(`ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "UQ_a3cfb26a07c0ac65bd019e9bc50"`);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_quotes_org_number" ON "quotes" ("organization_id", "quoteNumber")`,
    );

    await q.query(`
      ALTER TABLE "quotes"
        ALTER COLUMN "subtotal" TYPE numeric(18,2),
        ALTER COLUMN "total" TYPE numeric(18,2),
        ADD COLUMN IF NOT EXISTS "discount_total" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "tax_total" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "document_discount_rate" numeric(7,6) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "notes" text,
        ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "rejection_reason" text,
        ADD COLUMN IF NOT EXISTS "invoice_id" uuid
    `);

    await q.query(`
      ALTER TABLE "quote_lines"
        ALTER COLUMN "quantity" TYPE numeric(18,6),
        ALTER COLUMN "unitPrice" TYPE numeric(18,6),
        ALTER COLUMN "lineTotal" TYPE numeric(18,2),
        ADD COLUMN IF NOT EXISTS "line_order" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "discount_rate" numeric(7,6) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "tax_rate" numeric(7,6) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "tax_amount" numeric(18,2) NOT NULL DEFAULT 0
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "quote_lines"
        DROP COLUMN IF EXISTS "tax_amount",
        DROP COLUMN IF EXISTS "tax_rate",
        DROP COLUMN IF EXISTS "discount_rate",
        DROP COLUMN IF EXISTS "line_order",
        ALTER COLUMN "lineTotal" TYPE numeric(10,2),
        ALTER COLUMN "unitPrice" TYPE numeric(10,2),
        ALTER COLUMN "quantity" TYPE integer USING round("quantity")::integer
    `);
    await q.query(`
      ALTER TABLE "quotes"
        DROP COLUMN IF EXISTS "invoice_id",
        DROP COLUMN IF EXISTS "rejection_reason",
        DROP COLUMN IF EXISTS "rejected_at",
        DROP COLUMN IF EXISTS "accepted_at",
        DROP COLUMN IF EXISTS "sent_at",
        DROP COLUMN IF EXISTS "notes",
        DROP COLUMN IF EXISTS "document_discount_rate",
        DROP COLUMN IF EXISTS "tax_total",
        DROP COLUMN IF EXISTS "discount_total",
        ALTER COLUMN "total" TYPE numeric(12,2),
        ALTER COLUMN "subtotal" TYPE numeric(12,2)
    `);
    await q.query(`DROP INDEX IF EXISTS "UQ_quotes_org_number"`);
    await q.query(`ALTER TABLE "quotes" ADD CONSTRAINT "UQ_a3cfb26a07c0ac65bd019e9bc50" UNIQUE ("quoteNumber")`);
    // An enum value cannot be dropped; CANCELLED stays, unused.
  }
}
