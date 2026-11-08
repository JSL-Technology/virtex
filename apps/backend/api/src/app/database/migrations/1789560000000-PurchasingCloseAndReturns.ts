import { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

/**
 * Purchasing basics the mid-market expects (audit 2026-11-07, CMP-15): closing an order's
 * outstanding balance, a tolerance for over-delivery, and returning part of a receipt.
 */
export class PurchasingCloseAndReturns1789560000000 implements MigrationInterface {
  name = 'PurchasingCloseAndReturns1789560000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TYPE "public"."purchase_orders_status_enum" ADD VALUE IF NOT EXISTS 'CLOSED' BEFORE 'CANCELLED'`);
    await q.query(`ALTER TABLE "purchase_orders" ADD COLUMN "closed_at" TIMESTAMP WITH TIME ZONE, ADD COLUMN "close_reason" text`);
    await q.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN "po_receipt_over_tolerance_bps" integer NOT NULL DEFAULT 0,
        ADD CONSTRAINT "CHK_organization_settings_po_receipt_over_tolerance"
          CHECK ("po_receipt_over_tolerance_bps" BETWEEN 0 AND 5000)`);

    // «No more can arrive than was ordered» becomes «no more than was ordered plus the company's
    // tolerance». The table still enforces it, now against the tenant's own setting, because an
    // invariant that lives only in one service is one a future writer can walk around.
    await q.query(`ALTER TABLE "purchase_order_lines" DROP CONSTRAINT "CHK_purchase_order_lines_received_within_ordered"`);
    await q.query(`
      ALTER TABLE "purchase_order_lines"
        ADD CONSTRAINT "CHK_purchase_order_lines_received_not_negative" CHECK ("received_quantity" >= 0)`);
    await q.query(`
      CREATE OR REPLACE FUNCTION virtex_po_line_received_within_tolerance() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        bps integer;
      BEGIN
        IF NEW."received_quantity" <= NEW."quantity" THEN
          RETURN NEW;
        END IF;
        SELECT COALESCE(s."po_receipt_over_tolerance_bps", 0) INTO bps
          FROM "organization_settings" s WHERE s."organization_id" = NEW."organization_id";
        IF NEW."received_quantity" > NEW."quantity" * (1 + COALESCE(bps, 0) / 10000.0) + 0.000001 THEN
          RAISE EXCEPTION 'purchase order line % would receive % of % ordered, beyond the % bps tolerance',
            NEW."id", NEW."received_quantity", NEW."quantity", COALESCE(bps, 0)
            USING ERRCODE = 'check_violation', CONSTRAINT = 'CHK_purchase_order_lines_received_within_ordered';
        END IF;
        RETURN NEW;
      END
      $$`);
    await q.query(`
      CREATE TRIGGER "TRG_purchase_order_lines_received_within_tolerance"
        BEFORE INSERT OR UPDATE OF "received_quantity", "quantity" ON "purchase_order_lines"
        FOR EACH ROW EXECUTE FUNCTION virtex_po_line_received_within_tolerance()`);
    await q.query(`
      CREATE TABLE "purchase_returns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "number" character varying(40) NOT NULL,
        "receipt_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "date" date NOT NULL,
        "reason" text NOT NULL,
        "lines" jsonb NOT NULL,
        "journal_entry_id" uuid,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_purchase_returns" PRIMARY KEY ("id"),
        CONSTRAINT "FK_purchase_returns_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_returns_receipt" FOREIGN KEY ("receipt_id") REFERENCES "purchase_order_receipts"("id") ON DELETE CASCADE
      )`);
    await q.query(`CREATE INDEX "IDX_purchase_returns_receipt" ON "purchase_returns" ("organization_id", "receipt_id")`);
    await q.query(`ALTER TABLE "purchase_returns" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "purchase_returns" FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "purchase_returns"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})`);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_returns" TO virtex_app;
        END IF;
      END
      $$`);
    await q.query(`SELECT virtex_install_same_tenant_guards()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "purchase_returns"`);
    await q.query(`DROP TRIGGER "TRG_purchase_order_lines_received_within_tolerance" ON "purchase_order_lines"`);
    await q.query(`DROP FUNCTION virtex_po_line_received_within_tolerance()`);
    await q.query(`ALTER TABLE "purchase_order_lines" DROP CONSTRAINT "CHK_purchase_order_lines_received_not_negative"`);
    // Lines received within a tolerance no longer fit the strict rule; they are capped at what was ordered.
    await q.query(`UPDATE "purchase_order_lines" SET "received_quantity" = "quantity" WHERE "received_quantity" > "quantity"`);
    await q.query(`
      ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "CHK_purchase_order_lines_received_within_ordered"
        CHECK ("received_quantity" >= 0 AND "received_quantity" <= "quantity")`);
    await q.query(`ALTER TABLE "organization_settings" DROP COLUMN "po_receipt_over_tolerance_bps"`);
    await q.query(`UPDATE "purchase_orders" SET "status" = 'RECEIVED' WHERE "status" = 'CLOSED'`);
    await q.query(`ALTER TABLE "purchase_orders" DROP COLUMN "closed_at", DROP COLUMN "close_reason"`);
  }
}
