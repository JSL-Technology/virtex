import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stock by warehouse, and the documents that move it by hand.
 *
 * Until now a product's quantity on hand was one column for the whole company, changed by editing
 * the product, and the stock ledger recorded receipts but not sales, so it could not explain the
 * balance it sat beside. This makes the ledger the source:
 *
 *   - `warehouses.is_default` — one per company, where stock goes when nothing says otherwise;
 *   - `stock_movements.warehouse_id` — every movement happens somewhere;
 *   - `stock_levels` — the balance per product × warehouse, written with every movement;
 *   - `inventory_adjustments` and `stock_transfers`, with their lines — the documents that replace
 *     editing «stock» on the product form.
 *
 * ## The data already there
 *
 * A company that holds stock or has movements gets a default warehouse: its oldest active one, or
 * a new «Almacén principal» when it has none. Every existing movement is placed there — nothing
 * recorded where it happened. Because sales never wrote the ledger, a product's movements do not
 * add up to its stock; the difference is recorded as ONE opening movement at the start of the
 * product's history, labelled as such, so the kardex closes on the real balance from day one and
 * does not pretend to know when the unrecorded sales happened. The per-warehouse balances are then
 * the sum of the ledger, which by construction equals `products.stock`.
 *
 * `stock_items` is dropped: nothing ever wrote it, and its columns were mapped twice.
 *
 * ## NO ACTION, not RESTRICT
 *
 * Every reference to a warehouse or a branch blocks deleting one that is in use — but as NO
 * ACTION, which PostgreSQL checks at the end of the statement, not RESTRICT, which it checks row by
 * row. Deleting a company cascades through its documents, warehouses and branches in one statement
 * in no guaranteed order; with RESTRICT the cascade failed as soon as it reached a branch before
 * the invoices issued there. The branch references added by `Branches1789009200000` are
 * re-declared the same way here.
 */
const BRANCH_DOCUMENT_TABLES = [
  'invoices',
  'quotes',
  'customer_payments',
  'vendor_bills',
  'payment_batches',
  'purchase_orders',
  'purchase_order_receipts',
  'pos_shifts',
  'pos_sales',
  'warehouses',
] as const;
const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

export class StockByWarehouse1789009300000 implements MigrationInterface {
  name = 'StockByWarehouse1789009300000';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of BRANCH_DOCUMENT_TABLES) {
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "FK_${table}_branch"`);
      await q.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "FK_${table}_branch"
          FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION
      `);
    }

    // ── Default warehouse ────────────────────────────────────────────────────
    await q.query(`ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false`);
    await q.query(`
      UPDATE "warehouses" w SET "is_default" = true
        FROM (
          SELECT DISTINCT ON ("organization_id") "id"
            FROM "warehouses"
           ORDER BY "organization_id", "isActive" DESC, "created_at" ASC, "id" ASC
        ) first
       WHERE w."id" = first."id"
    `);
    // Companies that hold stock or have movements but no warehouse at all.
    await q.query(`
      INSERT INTO "warehouses" ("organization_id", "name", "code", "isActive", "is_default")
      SELECT o."organization_id", 'Almacén principal', 'PRINCIPAL', true, true
        FROM (
          SELECT p."organization_id" FROM "products" p
           WHERE p."kind" <> 'SERVICE' AND p."stock" <> 0
          UNION
          SELECT p."organization_id" FROM "stock_movements" m JOIN "products" p ON p."id" = m."product_id"
        ) o
       WHERE NOT EXISTS (SELECT 1 FROM "warehouses" w WHERE w."organization_id" = o."organization_id")
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_warehouses_org_default"
        ON "warehouses" ("organization_id") WHERE "is_default" = true
    `);

    // ── Movements happen somewhere ───────────────────────────────────────────
    await q.query(`ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "warehouse_id" uuid`);
    await q.query(`
      UPDATE "stock_movements" m SET
        "organization_id" = p."organization_id",
        "warehouse_id" = w."id"
        FROM "products" p
        JOIN "warehouses" w ON w."organization_id" = p."organization_id" AND w."is_default" = true
       WHERE p."id" = m."product_id" AND m."warehouse_id" IS NULL
    `);

    // The balance the ledger never recorded, as one labelled opening line per product.
    await q.query(`
      INSERT INTO "stock_movements"
        ("product_id", "organization_id", "warehouse_id", "quantity", "cost", "type", "reference", "source_type", "date")
      SELECT p."id", p."organization_id", w."id",
             p."stock" - COALESCE(moved."total", 0),
             p."cost",
             'OPENING',
             'Saldo inicial (movimientos anteriores no registrados)',
             'migration_opening',
             LEAST(p."created_at"::timestamp, COALESCE(moved."first", p."created_at"::timestamp)) - interval '1 second'
        FROM "products" p
        JOIN "warehouses" w ON w."organization_id" = p."organization_id" AND w."is_default" = true
        LEFT JOIN (
          SELECT "product_id", SUM("quantity") AS "total", MIN("date") AS "first"
            FROM "stock_movements" GROUP BY "product_id"
        ) moved ON moved."product_id" = p."id"
       WHERE p."kind" <> 'SERVICE'
         AND p."stock" - COALESCE(moved."total", 0) <> 0
    `);

    // The product foreign key is deferred; its checks for the rows just inserted must run now, or
    // PostgreSQL refuses to alter a table with trigger events still pending.
    await q.query(`SET CONSTRAINTS ALL IMMEDIATE`);
    await q.query(`ALTER TABLE "stock_movements" ALTER COLUMN "warehouse_id" SET NOT NULL`);
    await q.query(`
      ALTER TABLE "stock_movements"
        ADD CONSTRAINT "FK_stock_movements_warehouse"
        FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_stock_movements_org_warehouse_date"
        ON "stock_movements" ("organization_id", "warehouse_id", "date")
    `);

    // ── Balance per product × warehouse ──────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "stock_levels" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "quantity_on_hand" numeric(18,6) NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_levels" PRIMARY KEY ("id"),
        CONSTRAINT "FK_stock_levels_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_stock_levels_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_stock_levels_warehouse" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION
      )
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_stock_levels_product_warehouse" ON "stock_levels" ("product_id", "warehouse_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_stock_levels_org_warehouse" ON "stock_levels" ("organization_id", "warehouse_id")`);
    await q.query(`
      INSERT INTO "stock_levels" ("organization_id", "product_id", "warehouse_id", "quantity_on_hand")
      SELECT m."organization_id", m."product_id", m."warehouse_id", SUM(m."quantity")
        FROM "stock_movements" m
       GROUP BY m."organization_id", m."product_id", m."warehouse_id"
      ON CONFLICT ("product_id", "warehouse_id") DO NOTHING
    `);

    await q.query(`DROP TABLE IF EXISTS "stock_items"`);
    await q.query(`ALTER TABLE "purchase_order_receipts" ADD COLUMN IF NOT EXISTS "warehouse_id" uuid`);
    // A past receipt that stocked goods put them where its ledger lines now say.
    await q.query(`
      UPDATE "purchase_order_receipts" r SET "warehouse_id" = m."warehouse_id"
        FROM (SELECT DISTINCT ON ("source_id") "source_id", "warehouse_id" FROM "stock_movements"
               WHERE "source_type" = 'purchase_order_receipt') m
       WHERE m."source_id" = r."id" AND r."warehouse_id" IS NULL
    `);

    // ── Adjustments ──────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "inventory_adjustments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "number" character varying(40) NOT NULL,
        "date" date NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "reason" character varying(255) NOT NULL,
        "notes" text,
        "status" character varying(16) NOT NULL DEFAULT 'DRAFT',
        "value_change" numeric(18,2),
        "journal_entry_id" uuid,
        "created_by_user_id" uuid,
        "posted_by_user_id" uuid,
        "posted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_inventory_adjustments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inventory_adjustments_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inventory_adjustments_warehouse" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION
      )
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_inventory_adjustments_org_number" ON "inventory_adjustments" ("organization_id", "number")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_inventory_adjustments_org_date" ON "inventory_adjustments" ("organization_id", "date")`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "inventory_adjustment_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "adjustment_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "counted_quantity" numeric(18,6),
        "quantity_change" numeric(18,6) NOT NULL DEFAULT 0,
        "quantity_before" numeric(18,6),
        "unit_cost" numeric(18,6),
        "new_unit_cost" numeric(18,6),
        "value_change" numeric(18,2),
        CONSTRAINT "PK_inventory_adjustment_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inventory_adjustment_lines_adjustment" FOREIGN KEY ("adjustment_id") REFERENCES "inventory_adjustments"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inventory_adjustment_lines_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION
      )
    `);

    // ── Transfers ────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "stock_transfers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "number" character varying(40) NOT NULL,
        "date" date NOT NULL,
        "from_warehouse_id" uuid NOT NULL,
        "to_warehouse_id" uuid NOT NULL,
        "notes" text,
        "status" character varying(16) NOT NULL DEFAULT 'DRAFT',
        "created_by_user_id" uuid,
        "posted_by_user_id" uuid,
        "posted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_stock_transfers" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stock_transfers_distinct_warehouses" CHECK ("from_warehouse_id" <> "to_warehouse_id"),
        CONSTRAINT "FK_stock_transfers_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_stock_transfers_from_warehouse" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_stock_transfers_to_warehouse" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION
      )
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_stock_transfers_org_number" ON "stock_transfers" ("organization_id", "number")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_stock_transfers_org_date" ON "stock_transfers" ("organization_id", "date")`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "stock_transfer_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "transfer_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "quantity" numeric(18,6) NOT NULL,
        CONSTRAINT "PK_stock_transfer_lines" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stock_transfer_lines_positive" CHECK ("quantity" > 0),
        CONSTRAINT "FK_stock_transfer_lines_transfer" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_stock_transfer_lines_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION
      )
    `);

    // ── Isolation ────────────────────────────────────────────────────────────
    for (const table of ['stock_levels', 'inventory_adjustments', 'stock_transfers']) {
      await this.isolate(q, table, `"organization_id" = ${TENANT}`);
    }
    await this.isolate(
      q,
      'inventory_adjustment_lines',
      `EXISTS (SELECT 1 FROM "inventory_adjustments" p0 WHERE p0.id = "inventory_adjustment_lines".adjustment_id AND p0.organization_id = ${TENANT})`,
    );
    await this.isolate(
      q,
      'stock_transfer_lines',
      `EXISTS (SELECT 1 FROM "stock_transfers" p0 WHERE p0.id = "stock_transfer_lines".transfer_id AND p0.organization_id = ${TENANT})`,
    );
  }

  private async isolate(q: QueryRunner, table: string, predicate: string): Promise<void> {
    await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
    await q.query(`CREATE POLICY tenant_isolation ON "${table}" USING (${predicate}) WITH CHECK (${predicate})`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of BRANCH_DOCUMENT_TABLES) {
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "FK_${table}_branch"`);
      await q.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "FK_${table}_branch"
          FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT
      `);
    }

    await q.query(`DROP TABLE IF EXISTS "stock_transfer_lines"`);
    await q.query(`DROP TABLE IF EXISTS "stock_transfers"`);
    await q.query(`DROP TABLE IF EXISTS "inventory_adjustment_lines"`);
    await q.query(`DROP TABLE IF EXISTS "inventory_adjustments"`);
    await q.query(`DROP TABLE IF EXISTS "stock_levels"`);
    await q.query(`ALTER TABLE "purchase_order_receipts" DROP COLUMN IF EXISTS "warehouse_id"`);
    await q.query(`DELETE FROM "stock_movements" WHERE "source_type" = 'migration_opening'`);
    await q.query(`DROP INDEX IF EXISTS "IDX_stock_movements_org_warehouse_date"`);
    await q.query(`ALTER TABLE "stock_movements" DROP CONSTRAINT IF EXISTS "FK_stock_movements_warehouse"`);
    await q.query(`ALTER TABLE "stock_movements" DROP COLUMN IF EXISTS "warehouse_id"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_warehouses_org_default"`);
    await q.query(`ALTER TABLE "warehouses" DROP COLUMN IF EXISTS "is_default"`);
    // `stock_items` held nothing; it is not recreated.
  }
}
