import { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
const BASE = `
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "organization_id" uuid NOT NULL`;

const TABLES = [
  'purchase_rfqs',
  'purchase_rfq_lines',
  'purchase_rfq_suppliers',
  'supplier_quotes',
  'supplier_quote_lines',
  'purchase_agreements',
  'purchase_agreement_lines',
];

/**
 * Requests for quotation, supplier quotations and purchase agreements (audit 2026-11-07, CMP-15):
 * the last two capabilities of the mid-market purchasing cycle the audit found missing.
 *
 *  - An RFQ asks several suppliers for one set of lines; each answer is a quotation, priced per
 *    line. Awarding one turns it into a draft purchase order at its prices.
 *  - An agreement fixes prices with one supplier for a period, with a ceiling per line and,
 *    optionally, overall. Orders are released against it.
 *  - `purchase_orders` records where an order came from (`rfq_id`, `supplier_quote_id`,
 *    `agreement_id`) and each order line the agreement line it draws on; what an agreement has used
 *    is read from those lines, never kept as a counter.
 *
 * Every table is tenant-owned: RLS, FORCE, the application role's grant, and the same-tenant guard
 * on each of its references.
 */
export class QuotationsAndAgreements1789590000000 implements MigrationInterface {
  name = 'QuotationsAndAgreements1789590000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "purchase_rfqs" (${BASE},
        "number" character varying(40) NOT NULL,
        "title" character varying(200) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'DRAFT',
        "requisition_id" uuid,
        "currency_code" character varying(3) NOT NULL,
        "response_due_date" date,
        "notes" text,
        "sent_at" TIMESTAMP WITH TIME ZONE,
        "awarded_quote_id" uuid,
        "awarded_order_id" uuid,
        "awarded_by_user_id" uuid,
        "awarded_at" TIMESTAMP WITH TIME ZONE,
        "award_reason" text,
        "cancellation_reason" text,
        "created_by_user_id" uuid,
        CONSTRAINT "PK_purchase_rfqs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_purchase_rfqs_status" CHECK ("status" IN ('DRAFT', 'SENT', 'AWARDED', 'CANCELLED')),
        CONSTRAINT "FK_purchase_rfqs_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_rfqs_requisition" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_purchase_rfqs_org_number" ON "purchase_rfqs" ("organization_id", "number")`);
    await q.query(`CREATE INDEX "IDX_purchase_rfqs_org_status" ON "purchase_rfqs" ("organization_id", "status")`);

    await q.query(`
      CREATE TABLE "purchase_rfq_lines" (${BASE},
        "rfq_id" uuid NOT NULL,
        "product_id" uuid,
        "description" text NOT NULL,
        "quantity" numeric(18,6) NOT NULL,
        "unit_of_measure" character varying(16) NOT NULL DEFAULT 'UND',
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_purchase_rfq_lines" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_purchase_rfq_lines_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "FK_purchase_rfq_lines_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_rfq_lines_rfq" FOREIGN KEY ("rfq_id") REFERENCES "purchase_rfqs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_rfq_lines_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE INDEX "IDX_purchase_rfq_lines_rfq" ON "purchase_rfq_lines" ("rfq_id")`);

    await q.query(`
      CREATE TABLE "purchase_rfq_suppliers" (${BASE},
        "rfq_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        CONSTRAINT "PK_purchase_rfq_suppliers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_purchase_rfq_suppliers_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_rfq_suppliers_rfq" FOREIGN KEY ("rfq_id") REFERENCES "purchase_rfqs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_rfq_suppliers_supplier" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_purchase_rfq_suppliers" ON "purchase_rfq_suppliers" ("rfq_id", "supplier_id")`);

    await q.query(`
      CREATE TABLE "supplier_quotes" (${BASE},
        "rfq_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "reference" character varying(60),
        "received_on" date NOT NULL,
        "valid_until" date NOT NULL,
        "lead_time_days" integer,
        "status" character varying(16) NOT NULL DEFAULT 'RECEIVED',
        "subtotal" numeric(18,2) NOT NULL DEFAULT 0,
        "tax_total" numeric(18,2) NOT NULL DEFAULT 0,
        "total" numeric(18,2) NOT NULL DEFAULT 0,
        "notes" text,
        CONSTRAINT "PK_supplier_quotes" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_supplier_quotes_status" CHECK ("status" IN ('RECEIVED', 'AWARDED', 'DECLINED')),
        CONSTRAINT "CHK_supplier_quotes_validity" CHECK ("valid_until" >= "received_on"),
        CONSTRAINT "FK_supplier_quotes_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_supplier_quotes_rfq" FOREIGN KEY ("rfq_id") REFERENCES "purchase_rfqs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_supplier_quotes_supplier" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_supplier_quotes_rfq_supplier" ON "supplier_quotes" ("rfq_id", "supplier_id")`);

    await q.query(`
      CREATE TABLE "supplier_quote_lines" (${BASE},
        "quote_id" uuid NOT NULL,
        "rfq_line_id" uuid NOT NULL,
        "unit_price" numeric(18,6) NOT NULL,
        "tax_rate" numeric(9,6) NOT NULL DEFAULT 0,
        CONSTRAINT "PK_supplier_quote_lines" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_supplier_quote_lines_amounts" CHECK ("unit_price" >= 0 AND "tax_rate" >= 0 AND "tax_rate" <= 1),
        CONSTRAINT "FK_supplier_quote_lines_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_supplier_quote_lines_quote" FOREIGN KEY ("quote_id") REFERENCES "supplier_quotes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_supplier_quote_lines_rfq_line" FOREIGN KEY ("rfq_line_id") REFERENCES "purchase_rfq_lines"("id") ON DELETE CASCADE
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_supplier_quote_lines" ON "supplier_quote_lines" ("quote_id", "rfq_line_id")`);

    await q.query(`
      CREATE TABLE "purchase_agreements" (${BASE},
        "number" character varying(40) NOT NULL,
        "title" character varying(200) NOT NULL,
        "supplier_id" uuid NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'DRAFT',
        "valid_from" date NOT NULL,
        "valid_to" date NOT NULL,
        "currency_code" character varying(3) NOT NULL,
        "max_amount" numeric(18,2),
        "notes" text,
        "created_by_user_id" uuid,
        "activated_by_user_id" uuid,
        "activated_at" TIMESTAMP WITH TIME ZONE,
        "closed_at" TIMESTAMP WITH TIME ZONE,
        "close_reason" text,
        CONSTRAINT "PK_purchase_agreements" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_purchase_agreements_status" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED')),
        CONSTRAINT "CHK_purchase_agreements_validity" CHECK ("valid_to" >= "valid_from"),
        CONSTRAINT "CHK_purchase_agreements_max_amount" CHECK ("max_amount" IS NULL OR "max_amount" > 0),
        CONSTRAINT "FK_purchase_agreements_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_agreements_supplier" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_purchase_agreements_org_number" ON "purchase_agreements" ("organization_id", "number")`);
    await q.query(`CREATE INDEX "IDX_purchase_agreements_org_status" ON "purchase_agreements" ("organization_id", "status")`);

    await q.query(`
      CREATE TABLE "purchase_agreement_lines" (${BASE},
        "agreement_id" uuid NOT NULL,
        "product_id" uuid,
        "description" text NOT NULL,
        "unit_price" numeric(18,6) NOT NULL,
        "tax_rate" numeric(9,6) NOT NULL DEFAULT 0,
        "max_quantity" numeric(18,6),
        "unit_of_measure" character varying(16) NOT NULL DEFAULT 'UND',
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_purchase_agreement_lines" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_purchase_agreement_lines_amounts" CHECK ("unit_price" >= 0 AND "tax_rate" >= 0 AND "tax_rate" <= 1 AND ("max_quantity" IS NULL OR "max_quantity" > 0)),
        CONSTRAINT "FK_purchase_agreement_lines_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_agreement_lines_agreement" FOREIGN KEY ("agreement_id") REFERENCES "purchase_agreements"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_agreement_lines_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE INDEX "IDX_purchase_agreement_lines_agreement" ON "purchase_agreement_lines" ("agreement_id")`);

    await q.query(`
      ALTER TABLE "purchase_orders"
        ADD COLUMN "rfq_id" uuid,
        ADD COLUMN "supplier_quote_id" uuid,
        ADD COLUMN "agreement_id" uuid,
        ADD CONSTRAINT "FK_purchase_orders_rfq" FOREIGN KEY ("rfq_id") REFERENCES "purchase_rfqs"("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_purchase_orders_supplier_quote" FOREIGN KEY ("supplier_quote_id") REFERENCES "supplier_quotes"("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_purchase_orders_agreement" FOREIGN KEY ("agreement_id") REFERENCES "purchase_agreements"("id") ON DELETE RESTRICT`);
    await q.query(`CREATE INDEX "IDX_purchase_orders_agreement" ON "purchase_orders" ("agreement_id") WHERE "agreement_id" IS NOT NULL`);
    await q.query(`
      ALTER TABLE "purchase_order_lines"
        ADD COLUMN "agreement_line_id" uuid,
        ADD CONSTRAINT "FK_purchase_order_lines_agreement_line" FOREIGN KEY ("agreement_line_id") REFERENCES "purchase_agreement_lines"("id") ON DELETE RESTRICT`);
    await q.query(`CREATE INDEX "IDX_purchase_order_lines_agreement_line" ON "purchase_order_lines" ("agreement_line_id") WHERE "agreement_line_id" IS NOT NULL`);

    for (const table of TABLES) {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})`);
      await q.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO virtex_app;
          END IF;
        END
        $$`);
    }
    await q.query(`SELECT virtex_install_same_tenant_guards()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "IDX_purchase_order_lines_agreement_line"`);
    await q.query(`ALTER TABLE "purchase_order_lines" DROP CONSTRAINT "FK_purchase_order_lines_agreement_line", DROP COLUMN "agreement_line_id"`);
    await q.query(`DROP INDEX "IDX_purchase_orders_agreement"`);
    await q.query(`
      ALTER TABLE "purchase_orders"
        DROP CONSTRAINT "FK_purchase_orders_rfq",
        DROP CONSTRAINT "FK_purchase_orders_supplier_quote",
        DROP CONSTRAINT "FK_purchase_orders_agreement",
        DROP COLUMN "rfq_id",
        DROP COLUMN "supplier_quote_id",
        DROP COLUMN "agreement_id"`);
    for (const table of [...TABLES].reverse()) await q.query(`DROP TABLE "${table}"`);
  }
}
