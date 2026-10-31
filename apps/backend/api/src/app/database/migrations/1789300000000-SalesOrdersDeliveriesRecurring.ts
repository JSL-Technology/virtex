import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The distributor's cycle and the services firm's monthly bill.
 *
 * - `sales_orders` / `sales_order_lines`: what the customer ordered — usually from an accepted
 *   quote — with how much of each line has been delivered and invoiced.
 * - `delivery_notes` / `delivery_note_lines`: the conduce. Goods leave the warehouse with it (the
 *   stock moves here, not at invoicing), it is signed by whoever receives them, and it is invoiced
 *   afterwards, alone or several together. Before this the only path was quote → invoice, and the
 *   invoice moved the stock: a distributor that delivers in parts and bills at the end of the month
 *   could not record what actually happened.
 * - `recurring_invoices` / `recurring_invoice_runs`: an iguala, a rent, a monthly service — invoiced
 *   on its date without anybody remembering to. Each run is a row, unique per template and date, so
 *   a run repeated by two instances or by hand cannot bill the same month twice.
 */
export class SalesOrdersDeliveriesRecurring1789300000000 implements MigrationInterface {
  name = 'SalesOrdersDeliveriesRecurring1789300000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

    await q.query(`
      CREATE TABLE IF NOT EXISTS "sales_orders" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "branch_id" uuid NULL,
        "order_number" varchar(32) NOT NULL,
        "customer_id" uuid NOT NULL,
        "quote_id" uuid NULL,
        "customer_reference" varchar(80) NULL,
        "order_date" date NOT NULL,
        "expected_date" date NULL,
        "currency_code" char(3) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'CONFIRMED',
        "notes" text NULL,
        "subtotal" numeric(18,2) NOT NULL DEFAULT 0,
        "tax_total" numeric(18,2) NOT NULL DEFAULT 0,
        "total" numeric(18,2) NOT NULL DEFAULT 0,
        "cancel_reason" text NULL,
        "created_by_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales_orders" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sales_orders_org_number" UNIQUE ("organization_id", "order_number"),
        CONSTRAINT "CHK_sales_orders_status" CHECK ("status" IN ('CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CLOSED', 'CANCELLED')),
        CONSTRAINT "FK_sales_orders_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_sales_orders_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_sales_orders_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_sales_orders_org_status" ON "sales_orders" ("organization_id", "status", "order_date")`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "sales_order_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "line_order" integer NOT NULL DEFAULT 0,
        "product_id" uuid NULL,
        "description" varchar(500) NOT NULL,
        "is_stocked" boolean NOT NULL DEFAULT false,
        "quantity" numeric(18,6) NOT NULL,
        "delivered_quantity" numeric(18,6) NOT NULL DEFAULT 0,
        "invoiced_quantity" numeric(18,6) NOT NULL DEFAULT 0,
        "unit_price" numeric(18,6) NOT NULL,
        "discount_rate" numeric(7,6) NOT NULL DEFAULT 0,
        "tax_rate" numeric(7,6) NOT NULL DEFAULT 0,
        "line_total" numeric(18,2) NOT NULL DEFAULT 0,
        CONSTRAINT "PK_sales_order_lines" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_sales_order_lines_quantities" CHECK ("delivered_quantity" >= 0 AND "invoiced_quantity" >= 0 AND "delivered_quantity" <= "quantity" AND "invoiced_quantity" <= "quantity"),
        CONSTRAINT "FK_sales_order_lines_order" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE
      )
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "delivery_notes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "branch_id" uuid NULL,
        "number" varchar(32) NOT NULL,
        "order_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "delivery_date" date NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'POSTED',
        "invoice_id" uuid NULL,
        "driver_name" varchar(120) NULL,
        "vehicle_plate" varchar(20) NULL,
        "delivery_address" text NULL,
        "received_by" varchar(120) NULL,
        "notes" text NULL,
        "void_reason" text NULL,
        "created_by_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_delivery_notes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_delivery_notes_org_number" UNIQUE ("organization_id", "number"),
        CONSTRAINT "CHK_delivery_notes_status" CHECK ("status" IN ('POSTED', 'INVOICED', 'VOIDED')),
        CONSTRAINT "FK_delivery_notes_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_delivery_notes_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_delivery_notes_order" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_delivery_notes_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_delivery_notes_org_order" ON "delivery_notes" ("organization_id", "order_id")`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "delivery_note_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "delivery_note_id" uuid NOT NULL,
        "order_line_id" uuid NOT NULL,
        "product_id" uuid NULL,
        "description" varchar(500) NOT NULL,
        "quantity" numeric(18,6) NOT NULL,
        CONSTRAINT "PK_delivery_note_lines" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_delivery_note_lines_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "FK_delivery_note_lines_note" FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_delivery_note_lines_order_line" FOREIGN KEY ("order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE NO ACTION
      )
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "recurring_invoices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "branch_id" uuid NULL,
        "customer_id" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "frequency" varchar(16) NOT NULL,
        "start_date" date NOT NULL,
        "next_run_date" date NULL,
        "end_date" date NULL,
        "payment_term_days" integer NOT NULL DEFAULT 0,
        "auto_issue" boolean NOT NULL DEFAULT true,
        "currency_code" char(3) NULL,
        "lines" jsonb NOT NULL DEFAULT '[]',
        "notes" text NULL,
        "status" varchar(16) NOT NULL DEFAULT 'ACTIVE',
        "run_count" integer NOT NULL DEFAULT 0,
        "last_run_at" timestamptz NULL,
        "last_invoice_id" uuid NULL,
        "last_error" text NULL,
        "created_by_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recurring_invoices" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_recurring_invoices_frequency" CHECK ("frequency" IN ('MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL')),
        CONSTRAINT "CHK_recurring_invoices_status" CHECK ("status" IN ('ACTIVE', 'PAUSED', 'ENDED')),
        CONSTRAINT "FK_recurring_invoices_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_recurring_invoices_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_recurring_invoices_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_recurring_invoices_org_due" ON "recurring_invoices" ("organization_id", "status", "next_run_date")`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "recurring_invoice_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "recurring_invoice_id" uuid NOT NULL,
        "run_date" date NOT NULL,
        "status" varchar(16) NOT NULL,
        "invoice_id" uuid NULL,
        "error" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recurring_invoice_runs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_recurring_invoice_runs_template_date" UNIQUE ("recurring_invoice_id", "run_date"),
        CONSTRAINT "CHK_recurring_invoice_runs_status" CHECK ("status" IN ('CREATED', 'FAILED')),
        CONSTRAINT "FK_recurring_invoice_runs_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_recurring_invoice_runs_template" FOREIGN KEY ("recurring_invoice_id") REFERENCES "recurring_invoices"("id") ON DELETE CASCADE
      )
    `);

    const policies: Array<[string, string]> = [
      ['sales_orders', `"organization_id" = ${TENANT}`],
      ['sales_order_lines', `EXISTS (SELECT 1 FROM "sales_orders" p0 WHERE p0.id = "sales_order_lines".order_id AND p0.organization_id = ${TENANT})`],
      ['delivery_notes', `"organization_id" = ${TENANT}`],
      ['delivery_note_lines', `EXISTS (SELECT 1 FROM "delivery_notes" p0 WHERE p0.id = "delivery_note_lines".delivery_note_id AND p0.organization_id = ${TENANT})`],
      ['recurring_invoices', `"organization_id" = ${TENANT}`],
      ['recurring_invoice_runs', `"organization_id" = ${TENANT}`],
    ];
    for (const [table, predicate] of policies) {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await q.query(`CREATE POLICY tenant_isolation ON "${table}" USING (${predicate}) WITH CHECK (${predicate})`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['recurring_invoice_runs', 'recurring_invoices', 'delivery_note_lines', 'delivery_notes', 'sales_order_lines', 'sales_orders']) {
      await q.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
