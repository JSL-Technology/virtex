import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What the AI platform still needed from the rest of the ERP to do its job properly.
 *
 *  - `product_price_history`: a product's price and cost had no history at all — editing them
 *    overwrote the old value and audited nothing — so "the price of X changed by 60 % on Sunday
 *    night" was unknowable. Every change is now a row, written by the inventory module in the same
 *    transaction as the change itself.
 *  - `ai_src_daily_prices`: the price actually charged per product and day, from invoice and
 *    point-of-sale lines, with the discount given. The forecasting model uses it to learn how price
 *    and promotions move demand.
 *  - `ai_src_document_changes`: who changed or deleted an issued document, and when — the audit
 *    trail's metadata only, never the values. `audit_logs` carries no row-level policy (its tenant is
 *    nullable: it also records sign-in attempts), so this view filters by the tenant setting
 *    explicitly and is a security barrier: the engine reads the view, never the table.
 *  - `ai_model_runs.notified_at`: which finished runs have already been turned into notifications,
 *    so each one is announced exactly once, whichever API replica notices it.
 */
export class AiPhaseOneCompletion1789040000000 implements MigrationInterface {
  name = 'AiPhaseOneCompletion1789040000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

    await q.query(`
      CREATE TABLE IF NOT EXISTS "product_price_history" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "old_price" numeric(18,6) NULL,
        "new_price" numeric(18,6) NULL,
        "old_cost" numeric(18,6) NULL,
        "new_cost" numeric(18,6) NULL,
        "changed_by_user_id" uuid NULL,
        "changed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_price_history" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_price_history_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_product_price_history_product" FOREIGN KEY ("product_id")
          REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_product_price_history_org_product_changed"
        ON "product_price_history" ("organization_id", "product_id", "changed_at")
    `);
    await q.query(`ALTER TABLE "product_price_history" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "product_price_history" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "product_price_history"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "product_price_history"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);

    await q.query(`ALTER TABLE "ai_model_runs" ADD COLUMN IF NOT EXISTS "notified_at" timestamptz NULL`);

    // Price charged per product and day. Point-of-sale tickets that were invoiced are skipped: the
    // invoice line already counts them. A POS line whose product id is not a uuid is ignored rather
    // than allowed to fail the whole view.
    await q.query(`
      CREATE OR REPLACE VIEW "ai_src_daily_prices" WITH (security_invoker = true) AS
      SELECT s."organization_id", s."product_id", s."day",
             SUM(s."gross") / NULLIF(SUM(s."quantity"), 0) AS "avg_price",
             COALESCE(SUM(s."discount") / NULLIF(SUM(s."gross"), 0), 0) AS "discount_rate",
             SUM(s."quantity") AS "quantity"
        FROM (
          SELECT i."organization_id", l."productId" AS "product_id", i."issueDate" AS "day",
                 l."quantity", l."quantity" * l."price" AS "gross",
                 COALESCE(l."discount_amount", 0) + COALESCE(l."document_discount_amount", 0) AS "discount"
            FROM "invoice_line_item" l
            JOIN "invoices" i ON i."id" = l."invoiceId"
           WHERE i."status"::text NOT IN ('Draft', 'Void') AND i."type"::text = 'INVOICE'
             AND l."productId" IS NOT NULL AND l."quantity" > 0
          UNION ALL
          SELECT ps."organization_id", (item->>'productId')::uuid, (ps."createdAt")::date,
                 (item->>'quantity')::numeric, (item->>'quantity')::numeric * (item->>'price')::numeric, 0
            FROM "pos_sales" ps
            CROSS JOIN LATERAL jsonb_array_elements(ps."items") AS item
           WHERE ps."status"::text = 'PAID' AND ps."invoiceId" IS NULL
             AND (item->>'productId') ~ '^[0-9a-fA-F-]{36}$'
             AND (item->>'quantity') ~ '^[0-9.]+$' AND (item->>'price') ~ '^[0-9.]+$'
        ) s
       GROUP BY s."organization_id", s."product_id", s."day"
    `);

    await q.query(`
      CREATE OR REPLACE VIEW "ai_src_document_changes" WITH (security_barrier = true) AS
      SELECT a."organization_id", a."entity", a."entity_id", a."actionType"::text AS "action",
             a."user_id", a."created_at"
        FROM "audit_logs" a
       WHERE a."organization_id" = ${TENANT}
         AND a."actionType"::text IN ('CREATE', 'UPDATE', 'DELETE')
    `);

    await q.query(`
      GRANT SELECT ON "product_price_history", "customer_payments", "vendor_payment",
                      "ai_src_daily_prices", "ai_src_document_changes"
      TO virtex_ai_engine
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT ON "product_price_history" TO virtex_app;
          GRANT SELECT ON "ai_src_daily_prices" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP VIEW IF EXISTS "ai_src_document_changes"`);
    await q.query(`DROP VIEW IF EXISTS "ai_src_daily_prices"`);
    await q.query(`ALTER TABLE "ai_model_runs" DROP COLUMN IF EXISTS "notified_at"`);
    await q.query(`DROP TABLE IF EXISTS "product_price_history"`);
  }
}
