import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The engine reads the rest of the ERP only through `ai_src_*` views.
 *
 * Forecasting already did; anomaly detection and the cash projection queried `invoices`,
 * `vendor_bills`, `customer_payments`, `payroll_runs`… directly, each with its own idea of which
 * documents count. The two pipelines disagreed already: the cash projection skipped voided
 * invoices, the anomaly run did not. The rules now live here, once:
 *
 *  - an issued invoice is neither a draft, nor void, nor voided;
 *  - a posted bill is neither a draft, nor void, nor rejected, nor voided;
 *  - a customer payment counts when posted and not voided; a supplier payment when its batch is
 *    neither void nor voided;
 *  - a purchase order counts until it is cancelled.
 *
 * Every view is `security_invoker`: it reads as the engine's role, so the tenant's row-level
 * policies apply to it as they do to the tables. A change to a table the engine depends on now
 * breaks a migration (the view depends on its columns) instead of breaking the nightly run, and
 * the engine's tests check that its SQL names no other table.
 */
const VIEWS: Record<string, string> = {
  ai_src_organizations: `
    SELECT o."id" AS "organization_id", o."country", o."timezone"
      FROM "organizations" o`,

  ai_src_products: `
    SELECT p."organization_id", p."id" AS "product_id", p."name", p."kind", p."price", p."cost", p."category_id"
      FROM "products" p`,

  ai_src_warehouses: `
    SELECT w."organization_id", w."id" AS "warehouse_id", w."branch_id"
      FROM "warehouses" w`,

  ai_src_stock_on_hand: `
    SELECT l."organization_id", l."product_id", l."warehouse_id", l."quantity_on_hand"
      FROM "stock_levels" l
      JOIN "products" p ON p."id" = l."product_id"
     WHERE p."kind" = 'GOOD'`,

  ai_src_stock_movements: `
    SELECT m."organization_id", m."id", m."product_id", m."warehouse_id", m."date", m."type",
           m."quantity", m."cost"
      FROM "stock_movements" m`,

  ai_src_issued_invoices: `
    SELECT i."organization_id", i."id", i."invoiceNumber" AS "invoice_number", i."issueDate" AS "issue_date",
           i."dueDate" AS "due_date", i."branch_id", i."customer_id", i."customerName" AS "customer_name",
           i."type"::text AS "type", i."total", i."total_in_base_currency", i."balance",
           (i."balance" * CASE WHEN i."total" > 0 THEN i."total_in_base_currency" / i."total" ELSE 1 END) AS "balance_in_base_currency",
           COALESCE(i."discount_total", 0) AS "discount_total", i."created_at",
           (SELECT COUNT(*) FROM "invoice_line_item" l WHERE l."invoiceId" = i."id") AS "line_count"
      FROM "invoices" i
     WHERE i."status"::text NOT IN ('Draft', 'Void') AND i."voided_at" IS NULL`,

  ai_src_invoice_lines: `
    SELECT i."organization_id", i."id" AS "invoice_id", i."invoice_number", i."issue_date", i."branch_id",
           i."type" AS "invoice_type", l."productId" AS "product_id", l."quantity", l."price",
           COALESCE(l."taxable_base", l."line_subtotal") AS "net_amount", l."unit_cost", l."is_service"
      FROM "invoice_line_item" l
      JOIN "ai_src_issued_invoices" i ON i."id" = l."invoiceId"`,

  ai_src_posted_bills: `
    SELECT b."organization_id", b."id", b."vendor_id", s."name" AS "vendor_name", b."ncf", b."date",
           b."dueDate" AS "due_date", b."total", b."total_in_base_currency", b."balance",
           (b."balance" * CASE WHEN b."total" > 0 THEN b."total_in_base_currency" / b."total" ELSE 1 END) AS "balance_in_base_currency",
           b."branch_id", b."purchase_order_id"
      FROM "vendor_bills" b
      LEFT JOIN "suppliers" s ON s."id" = b."vendor_id"
     WHERE b."voided_at" IS NULL AND b."status"::text NOT IN ('VOID', 'REJECTED', 'DRAFT')`,

  ai_src_customer_payments: `
    SELECT p."organization_id", p."id", p."customer_id", p."reference", p."total_amount", p."payment_date", p."branch_id"
      FROM "customer_payments" p
     WHERE p."status"::text = 'POSTED' AND p."voided_at" IS NULL`,

  ai_src_customer_receipts: `
    SELECT p."organization_id", i."customer_id", p."payment_date", i."due_date", l."amount"
      FROM "customer_payment_lines" l
      JOIN "ai_src_customer_payments" p ON p."id" = l."payment_id"
      JOIN "ai_src_issued_invoices" i ON i."id" = l."invoice_id"
     WHERE i."type" <> 'CREDIT_NOTE'`,

  // A bill that was voided is worth nothing: anything settled against it is excess.
  ai_src_vendor_settlements: `
    SELECT b."organization_id", b."id" AS "bill_id", b."vendor_id", b."branch_id", b."date" AS "bill_date",
           b."dueDate" AS "bill_due_date",
           CASE WHEN b."voided_at" IS NOT NULL OR b."status"::text = 'VOID' THEN 0 ELSE b."total" END AS "bill_total",
           vp."id" AS "payment_id", vp."date" AS "payment_date", vp."amount"
      FROM "vendor_payment" vp
      JOIN "vendor_bills" b ON b."id" = vp."vendor_bill_id"
      JOIN "payment_batches" pb ON pb."id" = vp."payment_batch_id"
     WHERE pb."status"::text <> 'VOID' AND pb."voided_at" IS NULL`,

  ai_src_pos_sales: `
    SELECT s."organization_id", s."cashierId" AS "cashier_id", s."branch_id", s."createdAt" AS "created_at",
           s."status"::text AS "status", s."total"
      FROM "pos_sales" s`,

  ai_src_purchase_orders: `
    SELECT o."organization_id", o."id", o."number", o."supplier_id", o."branch_id", o."order_date",
           o."updated_at", o."status"::text AS "status", o."total"
      FROM "purchase_orders" o
     WHERE o."cancelled_at" IS NULL`,

  ai_src_purchase_order_lines: `
    SELECT o."organization_id", o."id" AS "order_id", o."number" AS "order_number", o."supplier_id", o."branch_id",
           o."order_date", o."updated_at" AS "order_updated_at", o."status" AS "order_status",
           l."id" AS "line_id", l."product_id", l."quantity", l."received_quantity", l."billed_quantity", l."unit_price"
      FROM "purchase_order_lines" l
      JOIN "ai_src_purchase_orders" o ON o."id" = l."order_id"`,

  ai_src_price_changes: `
    SELECT h."organization_id", h."id", h."product_id", p."name" AS "product_name", h."old_price", h."new_price",
           h."old_cost", h."new_cost", p."cost" AS "current_cost", h."changed_by_user_id", h."changed_at"
      FROM "product_price_history" h
      JOIN "products" p ON p."id" = h."product_id"`,

  // What leaves the company on each regular payroll: net pay and the employer's contributions.
  ai_src_payroll_outflows: `
    SELECT r."organization_id", r."pay_date", (COALESCE(r."total_net", 0) + COALESCE(r."total_employer_contributions", 0)) AS "amount"
      FROM "payroll_runs" r
     WHERE r."run_type"::text = 'REGULAR' AND r."status"::text IN ('APPROVED', 'PAID')`,
};

/** Views read by other views: created first, dropped last. */
const ORDER = [
  'ai_src_organizations',
  'ai_src_products',
  'ai_src_warehouses',
  'ai_src_stock_on_hand',
  'ai_src_stock_movements',
  'ai_src_issued_invoices',
  'ai_src_invoice_lines',
  'ai_src_posted_bills',
  'ai_src_customer_payments',
  'ai_src_customer_receipts',
  'ai_src_vendor_settlements',
  'ai_src_pos_sales',
  'ai_src_purchase_orders',
  'ai_src_purchase_order_lines',
  'ai_src_price_changes',
  'ai_src_payroll_outflows',
];

/** The tables under the views: a security-invoker view reads them as its caller. */
const BASE_TABLES = [
  'organizations', 'products', 'warehouses', 'stock_levels', 'stock_movements', 'invoices', 'invoice_line_item',
  'vendor_bills', 'suppliers', 'customer_payments', 'customer_payment_lines', 'vendor_payment', 'payment_batches',
  'pos_sales', 'purchase_orders', 'purchase_order_lines', 'product_price_history', 'payroll_runs',
];

export class AiEngineReadContract1789180000000 implements MigrationInterface {
  name = 'AiEngineReadContract1789180000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const view of ORDER) {
      await q.query(`CREATE OR REPLACE VIEW "${view}" WITH (security_invoker = true) AS ${VIEWS[view]}`);
    }
    const views = ORDER.map((view) => `"${view}"`).join(', ');
    const tables = BASE_TABLES.map((table) => `"${table}"`).join(', ');
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_ai_engine') THEN
          GRANT SELECT ON ${views} TO virtex_ai_engine;
          GRANT SELECT ON ${tables} TO virtex_ai_engine;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT ON ${views} TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const view of [...ORDER].reverse()) {
      await q.query(`DROP VIEW IF EXISTS "${view}"`);
    }
  }
}
