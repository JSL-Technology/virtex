import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Goods receipts that move stock and the ledger (QA C-07).
 *
 * Receiving a purchase order only counted quantities: the order said "Recibida · 10" while the
 * product's stock stayed where it was, `stock_movements` stayed empty and no entry reached the
 * books. The receipt is the moment the goods physically arrive, so it is where stock must move.
 *
 * Perpetual inventory with a receipt AND a supplier invoice as separate events needs a bridge
 * account, or one of them books the goods twice:
 *
 *     receipt   Dr Inventory                      Cr Goods received not invoiced (2115)
 *     invoice   Dr Goods received not invoiced    Cr Accounts payable
 *
 * What this migration adds:
 *
 *  1. The GRNI account for every existing tenant (new tenants get it from the chart template),
 *     named in the books language and hung under the same parent as accounts payable, and the
 *     setting that points at it.
 *  2. `purchase_order_receipts` — one row per delivery, so a partial receipt has a history and the
 *     entry it posted can be traced back to it. Tenant-isolated like every tenant table.
 *  3. `purchase_order_lines.billed_quantity`, and the link from a vendor-bill line to the order
 *     line it bills (`purchase_order_line_id`, with `grni_quantity`: how much of that line was
 *     cleared against a receipt rather than received by the bill itself). That is the three-way
 *     match: ordered, received, billed.
 *  4. `stock_movements` becomes a usable stock ledger: the orphan `"productId"` varchar that
 *     nothing ever wrote is dropped (the entity now maps the real `product_id` uuid), and each
 *     movement records its tenant and the document it came from.
 */
export class GoodsReceipts1789007900000 implements MigrationInterface {
  name = 'GoodsReceipts1789007900000';

  public async up(q: QueryRunner): Promise<void> {
    // ── 1. GRNI account ──────────────────────────────────────────────────────────────────────
    await q.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN IF NOT EXISTS "default_goods_received_not_invoiced_account_id" uuid
    `);
    await q.query(`
      WITH inserted AS (
        INSERT INTO "accounts"
          ("name", "type", "category", "nature", "isActive", "isPostable", "isSystemAccount",
           "parent_id", "organization_id", "system_role", "version", "code")
        SELECT CASE COALESCE(o."books_language", 'es')
                 WHEN 'pt' THEN jsonb_build_object('pt', 'Mercadorias Recebidas Não Faturadas')
                 WHEN 'en' THEN jsonb_build_object('en', 'Goods Received Not Invoiced')
                 ELSE jsonb_build_object('es', 'Mercancía Recibida No Facturada')
               END,
               'LIABILITY'::accounts_type_enum, 'CURRENT_LIABILITY'::accounts_category_enum,
               'CREDIT'::accounts_nature_enum, true, true, false,
               payable."parent_id", o."id", 'GOODS_RECEIVED_NOT_INVOICED', 1, '2115'
          FROM "organizations" o
          JOIN "accounts" payable
            ON payable."organization_id" = o."id" AND payable."system_role" = 'ACCOUNTS_PAYABLE'
         WHERE NOT EXISTS (
                 SELECT 1 FROM "accounts" a
                  WHERE a."organization_id" = o."id" AND a."system_role" = 'GOODS_RECEIVED_NOT_INVOICED'
               )
           AND NOT EXISTS (
                 SELECT 1 FROM "accounts" a WHERE a."organization_id" = o."id" AND a."code" = '2115'
               )
        RETURNING "id"
      )
      INSERT INTO "account_segments" ("order", "value", "account_id")
      SELECT 0, '2115', "id" FROM inserted
    `);
    await q.query(`
      UPDATE "organization_settings" s
         SET "default_goods_received_not_invoiced_account_id" = a."id"
        FROM "accounts" a
       WHERE a."organization_id" = s."organization_id"
         AND a."system_role" = 'GOODS_RECEIVED_NOT_INVOICED'
         AND s."default_goods_received_not_invoiced_account_id" IS NULL
    `);

    // ── 2. Receipts ──────────────────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "purchase_order_receipts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "received_by_user_id" uuid,
        "journal_entry_id" uuid,
        "notes" text,
        "lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
        CONSTRAINT "PK_purchase_order_receipts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_purchase_order_receipts_order"
          FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_purchase_order_receipts_order" ON "purchase_order_receipts" ("order_id")
    `);
    const predicate = `organization_id = (NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`ALTER TABLE "purchase_order_receipts" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "purchase_order_receipts" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "purchase_order_receipts"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "purchase_order_receipts"
        USING (${predicate})
        WITH CHECK (${predicate})
    `);

    // ── 3. Three-way match ───────────────────────────────────────────────────────────────────
    await q.query(`
      ALTER TABLE "purchase_order_lines"
        ADD COLUMN IF NOT EXISTS "billed_quantity" numeric(18,6) NOT NULL DEFAULT 0
    `);
    await q.query(`
      ALTER TABLE "vendor_bill_line"
        ADD COLUMN IF NOT EXISTS "purchase_order_line_id" uuid,
        ADD COLUMN IF NOT EXISTS "grni_quantity" numeric(18,6) NOT NULL DEFAULT 0
    `);
    await q.query(`
      ALTER TABLE "vendor_bill_line"
        ADD CONSTRAINT "FK_vendor_bill_line_purchase_order_line"
        FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await q.query(`
      ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "purchase_order_id" uuid
    `);
    await q.query(`
      ALTER TABLE "vendor_bills"
        ADD CONSTRAINT "FK_vendor_bills_purchase_order"
        FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);

    // ── 4. Stock ledger ──────────────────────────────────────────────────────────────────────
    await q.query(`ALTER TABLE "stock_movements" DROP COLUMN IF EXISTS "productId"`);
    await q.query(`
      ALTER TABLE "stock_movements"
        ADD COLUMN IF NOT EXISTS "organization_id" uuid,
        ADD COLUMN IF NOT EXISTS "source_type" character varying(40),
        ADD COLUMN IF NOT EXISTS "source_id" uuid
    `);
    // Nothing ever wrote this table, so these are safe on every existing database. A movement with
    // no product is meaningless, and a unit cost to two decimals truncates the product's own cost,
    // which is kept to six.
    await q.query(`ALTER TABLE "stock_movements" ALTER COLUMN "product_id" SET NOT NULL`);
    await q.query(`ALTER TABLE "stock_movements" ALTER COLUMN "quantity" TYPE numeric(18,6)`);
    await q.query(`ALTER TABLE "stock_movements" ALTER COLUMN "cost" TYPE numeric(18,6)`);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_stock_movements_product_date" ON "stock_movements" ("product_id", "date")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_stock_movements_product_date"`);
    await q.query(`ALTER TABLE "stock_movements" ALTER COLUMN "cost" TYPE numeric(12,2)`);
    await q.query(`ALTER TABLE "stock_movements" ALTER COLUMN "quantity" TYPE numeric(12,4)`);
    await q.query(`ALTER TABLE "stock_movements" ALTER COLUMN "product_id" DROP NOT NULL`);
    await q.query(`
      ALTER TABLE "stock_movements"
        DROP COLUMN IF EXISTS "source_id",
        DROP COLUMN IF EXISTS "source_type",
        DROP COLUMN IF EXISTS "organization_id"
    `);
    await q.query(`ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "productId" character varying`);
    await q.query(`UPDATE "stock_movements" SET "productId" = "product_id"::text WHERE "productId" IS NULL`);
    await q.query(`ALTER TABLE "vendor_bills" DROP CONSTRAINT IF EXISTS "FK_vendor_bills_purchase_order"`);
    await q.query(`ALTER TABLE "vendor_bills" DROP COLUMN IF EXISTS "purchase_order_id"`);
    await q.query(`ALTER TABLE "vendor_bill_line" DROP CONSTRAINT IF EXISTS "FK_vendor_bill_line_purchase_order_line"`);
    await q.query(`
      ALTER TABLE "vendor_bill_line"
        DROP COLUMN IF EXISTS "grni_quantity",
        DROP COLUMN IF EXISTS "purchase_order_line_id"
    `);
    await q.query(`ALTER TABLE "purchase_order_lines" DROP COLUMN IF EXISTS "billed_quantity"`);
    await q.query(`DROP TABLE IF EXISTS "purchase_order_receipts"`);
    await q.query(`
      ALTER TABLE "organization_settings"
        DROP COLUMN IF EXISTS "default_goods_received_not_invoiced_account_id"
    `);
    // Only an account nothing was posted to.
    await q.query(`
      DELETE FROM "accounts" a
       WHERE a."system_role" = 'GOODS_RECEIVED_NOT_INVOICED'
         AND NOT EXISTS (SELECT 1 FROM "journal_entry_lines" l WHERE l."account_id" = a."id")
    `);
  }
}
