import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Purchasing: what a requisition asks for, and the order it becomes.
 *
 * The purchasing screens showed four orders and three requisitions invented in the browser — the
 * same seven documents for every tenant of the product. Orders had no table at all; requisitions
 * had one, carrying a number, a requester, a status and a total, and nothing that said what anybody
 * wanted to buy. A requisition without lines cannot be approved on its merits, turned into an
 * order, or matched against what arrives.
 *
 * Nothing here touches the ledger. A purchase order is a commitment, not a transaction: the vendor
 * bill is what debits inventory and credits payables when the goods and the invoice arrive, and
 * posting at both ends would count every purchase twice.
 */
export class PurchasingDocuments1789004000000 implements MigrationInterface {
  name = 'PurchasingDocuments1789004000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── Requisitions gain lines, a decision trail and a link to the order ─────
    await q.query(`
      ALTER TABLE "purchase_requisitions"
        ADD COLUMN IF NOT EXISTS "notes" text,
        ADD COLUMN IF NOT EXISTS "decided_by_user_id" uuid,
        ADD COLUMN IF NOT EXISTS "decided_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "rejection_reason" text,
        ADD COLUMN IF NOT EXISTS "purchase_order_id" uuid
    `);
    // The total is derived from the lines; 15,2 could not hold what 18,2 documents elsewhere use.
    await q.query(`
      ALTER TABLE "purchase_requisitions"
        ALTER COLUMN "total_amount" TYPE numeric(18,2)
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "purchase_requisition_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid,
        "requisition_id" uuid NOT NULL,
        "product_id" uuid,
        "description" text NOT NULL,
        "quantity" numeric(18,6) NOT NULL DEFAULT 0,
        "estimated_unit_price" numeric(18,6) NOT NULL DEFAULT 0,
        "unit_of_measure" character varying(16) NOT NULL DEFAULT 'UND',
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_purchase_requisition_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_purchase_requisition_lines_requisition"
          FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_requisition_lines_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_purchase_requisition_lines_requisition"
        ON "purchase_requisition_lines" ("requisition_id")
    `);

    // ── Orders ───────────────────────────────────────────────────────────────
    await q.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."purchase_orders_status_enum" AS ENUM (
          'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT',
          'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "purchase_orders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid,
        "number" character varying NOT NULL,
        "supplier_id" uuid NOT NULL,
        "order_date" date NOT NULL,
        "expected_date" date,
        "status" "public"."purchase_orders_status_enum" NOT NULL DEFAULT 'DRAFT',
        "currency_code" character varying(3) NOT NULL DEFAULT 'USD',
        "exchange_rate" numeric(18,6) NOT NULL DEFAULT 1,
        "subtotal" numeric(18,2) NOT NULL DEFAULT 0,
        "tax_total" numeric(18,2) NOT NULL DEFAULT 0,
        "total" numeric(18,2) NOT NULL DEFAULT 0,
        "requisition_id" uuid,
        "approved_by_user_id" uuid,
        "approved_at" timestamptz,
        "sent_at" timestamptz,
        "cancelled_at" timestamptz,
        "cancellation_reason" text,
        "notes" text,
        "created_by_user_id" uuid,
        CONSTRAINT "PK_purchase_orders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_purchase_orders_supplier"
          FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT
      )
    `);
    // The order number is unique per tenant, not across the whole database.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_purchase_orders_org_number"
        ON "purchase_orders" ("organization_id", "number")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_purchase_orders_org_status"
        ON "purchase_orders" ("organization_id", "status")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid,
        "order_id" uuid NOT NULL,
        "product_id" uuid,
        "description" text NOT NULL,
        "quantity" numeric(18,6) NOT NULL DEFAULT 0,
        "received_quantity" numeric(18,6) NOT NULL DEFAULT 0,
        "unit_price" numeric(18,6) NOT NULL DEFAULT 0,
        "tax_rate" numeric(9,6) NOT NULL DEFAULT 0,
        "unit_of_measure" character varying(16) NOT NULL DEFAULT 'UND',
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_purchase_order_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_purchase_order_lines_order"
          FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_order_lines_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL,
        -- More cannot arrive than was ordered. The service enforces it; so does the table, because
        -- an invariant that lives only in one service is one a future writer can walk around.
        CONSTRAINT "CHK_purchase_order_lines_received_within_ordered"
          CHECK ("received_quantity" >= 0 AND "received_quantity" <= "quantity")
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_purchase_order_lines_order"
        ON "purchase_order_lines" ("order_id")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "purchase_order_lines"`);
    await q.query(`DROP TABLE IF EXISTS "purchase_orders"`);
    await q.query(`DROP TYPE IF EXISTS "public"."purchase_orders_status_enum"`);
    await q.query(`DROP TABLE IF EXISTS "purchase_requisition_lines"`);
    await q.query(`
      ALTER TABLE "purchase_requisitions"
        DROP COLUMN IF EXISTS "purchase_order_id",
        DROP COLUMN IF EXISTS "rejection_reason",
        DROP COLUMN IF EXISTS "decided_at",
        DROP COLUMN IF EXISTS "decided_by_user_id",
        DROP COLUMN IF EXISTS "notes"
    `);
  }
}
