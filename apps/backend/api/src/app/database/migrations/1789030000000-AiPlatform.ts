import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The AI platform's store, and the catalogue fields a photo can fill in.
 *
 * ## What is here
 *
 *   - `products` gains `barcode`, `brand` and `attributes`: what a product photo actually shows and
 *     the form had nowhere to put. The barcode is unique per tenant when present, like the SKU.
 *   - `product_images`: the photos themselves. `products.image_url` stays as the display URL; this
 *     is where the stored object (by key, never by URL — URLs expire) is recorded.
 *   - `ai_requests`: one row per call to a language or embedding model — who, which feature, which
 *     model, tokens, cost, latency, outcome. It is the audit trail, the cost ledger and the quota
 *     counter at once, so none of the three can disagree with another.
 *   - `ai_model_runs`: one row per forecasting or anomaly run, with the metrics it scored. A number
 *     on a screen can always be traced to the run that produced it.
 *   - `ai_forecasts`, `ai_inventory_insights`: what the forecasting engine writes.
 *   - `ai_anomalies`, `ai_anomaly_feedback`: what the anomaly engine writes, and what people said
 *     about it.
 *   - `product_embeddings`: image/text vectors for duplicate detection — only where the `vector`
 *     extension is installed (see below).
 *   - `ai_src_*` views: the read contract of the Python engine.
 *   - `virtex_ai_engine`: the engine's own database role.
 *
 * ## Isolation
 *
 * Every table carries `organization_id` and the same `tenant_isolation` policy as the rest of the
 * product, FORCED so the table owner is bound too. The views are `security_invoker`, so a read
 * through them is a read of the underlying tables AS THE CALLER — their policies apply. A plain view
 * would run as its owner, which in CI is a superuser: every tenant's rows, through one view.
 *
 * The engine role has no BYPASSRLS. It reads the source tables it needs and writes only the
 * `ai_*` tables the engine produces; each job sets `app.current_organization` exactly as
 * `runAsTenantJob` does, so a job for one tenant cannot see another's data even if it tried.
 *
 * ## pgvector is optional
 *
 * Duplicate detection by image similarity needs the `vector` extension. Most managed Postgres
 * offerings ship it, but a deployment without it must still migrate: everything else here works,
 * and duplicates are then detected by barcode and name alone. `product_embeddings` is therefore
 * created only when the extension can be, and no entity maps it — the service reaches it through
 * SQL after asking whether it exists.
 */
export class AiPlatform1789030000000 implements MigrationInterface {
  name = 'AiPlatform1789030000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

    // ── The plan meters AI calls ──────────────────────────────────────────────────
    // `SaasResource.AI_CREDITS` is stored in two PostgreSQL enums. Without the value, `seedPlans`
    // fails to write the new limit at boot and every metered call is refused for want of one.
    for (const type of ['saas_plan_limits_resource_enum', 'saas_usage_metrics_resource_enum']) {
      const exists = (await q.query(`SELECT 1 FROM pg_type WHERE typname = $1`, [type])).length > 0;
      if (exists) await q.query(`ALTER TYPE "${type}" ADD VALUE IF NOT EXISTS 'ai_credits'`);
    }

    // ── Catalogue fields a photo can fill ─────────────────────────────────────────
    await q.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "barcode" varchar(64) NULL`);
    await q.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "brand" varchar(120) NULL`);
    await q.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "attributes" jsonb NULL`);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_products_organization_barcode"
        ON "products" ("organization_id", "barcode") WHERE "barcode" IS NOT NULL
    `);

    // ── Product images ────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "product_images" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "product_id" uuid NULL,
        "storage_key" varchar(512) NOT NULL,
        "mime_type" varchar(64) NOT NULL,
        "file_size" integer NOT NULL,
        "width" integer NULL,
        "height" integer NULL,
        "sha256" char(64) NOT NULL,
        "is_primary" boolean NOT NULL DEFAULT false,
        "uploaded_by_user_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_images" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_images_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_product_images_product" FOREIGN KEY ("product_id")
          REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_product_images_org_product"
        ON "product_images" ("organization_id", "product_id")
    `);

    // ── AI requests: audit, cost and quota in one ledger ─────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "user_id" uuid NULL,
        "feature" varchar(64) NOT NULL,
        "provider" varchar(32) NOT NULL,
        "model" varchar(64) NOT NULL,
        "status" varchar(16) NOT NULL,
        "stop_reason" varchar(32) NULL,
        "error_code" varchar(64) NULL,
        "input_tokens" integer NOT NULL DEFAULT 0,
        "output_tokens" integer NOT NULL DEFAULT 0,
        "cache_read_tokens" integer NOT NULL DEFAULT 0,
        "cache_write_tokens" integer NOT NULL DEFAULT 0,
        "cost_micro_usd" bigint NOT NULL DEFAULT 0,
        "credits" integer NOT NULL DEFAULT 0,
        "latency_ms" integer NOT NULL DEFAULT 0,
        "input_hash" char(64) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_requests_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_requests_org_created"
        ON "ai_requests" ("organization_id", "created_at")
    `);

    // ── Model runs ────────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_model_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "kind" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'QUEUED',
        "trigger" varchar(16) NOT NULL,
        "requested_by_user_id" uuid NULL,
        "engine_version" varchar(32) NULL,
        "params" jsonb NOT NULL DEFAULT '{}',
        "metrics" jsonb NULL,
        "data_hash" char(64) NULL,
        "error" text NULL,
        "started_at" timestamptz NULL,
        "finished_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_model_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_model_runs_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_model_runs_org_kind_created"
        ON "ai_model_runs" ("organization_id", "kind", "created_at")
    `);

    // ── Forecasts: one row per series and day, P10/P50/P90 ────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_forecasts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "branch_id" uuid NULL,
        "forecast_date" date NOT NULL,
        "p10" numeric(18,6) NOT NULL DEFAULT 0,
        "p50" numeric(18,6) NOT NULL DEFAULT 0,
        "p90" numeric(18,6) NOT NULL DEFAULT 0,
        "model" varchar(48) NOT NULL,
        CONSTRAINT "PK_ai_forecasts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_forecasts_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_forecasts_run" FOREIGN KEY ("run_id")
          REFERENCES "ai_model_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_forecasts_product" FOREIGN KEY ("product_id")
          REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_forecasts_org_product_warehouse_date"
        ON "ai_forecasts" ("organization_id", "product_id", "warehouse_id", "forecast_date")
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_ai_forecasts_run" ON "ai_forecasts" ("run_id")`);

    // ── Inventory insights: one row per series, replaced by every run ─────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_inventory_insights" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "branch_id" uuid NULL,
        "on_hand" numeric(18,6) NOT NULL DEFAULT 0,
        "avg_daily_demand" numeric(18,6) NOT NULL DEFAULT 0,
        "forecast_30d" numeric(18,6) NOT NULL DEFAULT 0,
        "forecast_30d_p90" numeric(18,6) NOT NULL DEFAULT 0,
        "days_of_cover" numeric(18,6) NULL,
        "stockout_date" date NULL,
        "lead_time_days" numeric(18,6) NULL,
        "safety_stock" numeric(18,6) NOT NULL DEFAULT 0,
        "reorder_point" numeric(18,6) NOT NULL DEFAULT 0,
        "suggested_order_qty" numeric(18,6) NOT NULL DEFAULT 0,
        "service_level" numeric(9,6) NOT NULL,
        "status" varchar(16) NOT NULL,
        "branch_rank" integer NULL,
        "model" varchar(48) NOT NULL,
        "accuracy_wape" numeric(18,6) NULL,
        "censored_days" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_inventory_insights" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_inventory_insights_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_inventory_insights_run" FOREIGN KEY ("run_id")
          REFERENCES "ai_model_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_inventory_insights_product" FOREIGN KEY ("product_id")
          REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ai_inventory_insights_org_product_warehouse"
        ON "ai_inventory_insights" ("organization_id", "product_id", "warehouse_id")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_inventory_insights_org_status"
        ON "ai_inventory_insights" ("organization_id", "status")
    `);

    // ── Anomalies and what people said about them ─────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_anomalies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "run_id" uuid NULL,
        "detector" varchar(48) NOT NULL,
        "category" varchar(32) NOT NULL,
        "severity" varchar(16) NOT NULL,
        "score" numeric(9,6) NOT NULL DEFAULT 0,
        "entity_type" varchar(48) NOT NULL,
        "entity_id" uuid NULL,
        "branch_id" uuid NULL,
        "occurred_on" date NOT NULL,
        "fingerprint" varchar(128) NOT NULL,
        "evidence" jsonb NOT NULL DEFAULT '{}',
        "explanation" text NULL,
        "status" varchar(16) NOT NULL DEFAULT 'OPEN',
        "resolved_by_user_id" uuid NULL,
        "resolved_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_anomalies" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_anomalies_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_anomalies_run" FOREIGN KEY ("run_id")
          REFERENCES "ai_model_runs"("id") ON DELETE SET NULL
      )
    `);
    // The same finding, raised again by tomorrow's run, is the same anomaly — not a new one.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ai_anomalies_org_fingerprint"
        ON "ai_anomalies" ("organization_id", "fingerprint")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_anomalies_org_status_occurred"
        ON "ai_anomalies" ("organization_id", "status", "occurred_on")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_anomaly_feedback" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "anomaly_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "verdict" varchar(16) NOT NULL,
        "comment" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_anomaly_feedback" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_anomaly_feedback_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_anomaly_feedback_anomaly" FOREIGN KEY ("anomaly_id")
          REFERENCES "ai_anomalies"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_anomaly_feedback_org_anomaly"
        ON "ai_anomaly_feedback" ("organization_id", "anomaly_id")
    `);

    const tables = [
      'product_images',
      'ai_requests',
      'ai_model_runs',
      'ai_forecasts',
      'ai_inventory_insights',
      'ai_anomalies',
      'ai_anomaly_feedback',
    ];

    // ── Embeddings, where the extension exists ────────────────────────────────────
    const vectorAvailable =
      (
        await q.query(`SELECT 1 FROM pg_available_extensions WHERE name = 'vector'`)
      ).length > 0;
    if (vectorAvailable) {
      await q.query(`CREATE EXTENSION IF NOT EXISTS vector`);
      await q.query(`
        CREATE TABLE IF NOT EXISTS "product_embeddings" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "organization_id" uuid NOT NULL,
          "product_id" uuid NULL,
          "image_id" uuid NULL,
          "source" varchar(16) NOT NULL,
          "model" varchar(64) NOT NULL,
          "embedding" vector(1024) NOT NULL,
          "created_at" timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT "PK_product_embeddings" PRIMARY KEY ("id"),
          CONSTRAINT "FK_product_embeddings_organization" FOREIGN KEY ("organization_id")
            REFERENCES "organizations"("id") ON DELETE CASCADE,
          CONSTRAINT "FK_product_embeddings_product" FOREIGN KEY ("product_id")
            REFERENCES "products"("id") ON DELETE CASCADE,
          CONSTRAINT "FK_product_embeddings_image" FOREIGN KEY ("image_id")
            REFERENCES "product_images"("id") ON DELETE CASCADE
        )
      `);
      await q.query(`
        CREATE INDEX IF NOT EXISTS "IDX_product_embeddings_org_product"
          ON "product_embeddings" ("organization_id", "product_id")
      `);
      await q.query(`
        CREATE INDEX IF NOT EXISTS "IDX_product_embeddings_hnsw"
          ON "product_embeddings" USING hnsw ("embedding" vector_cosine_ops)
      `);
      tables.push('product_embeddings');
    }

    for (const table of tables) {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await q.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
      `);
    }

    // ── The engine's read contract ────────────────────────────────────────────────
    //
    // Units sold per product, warehouse and day: dispatches out, minus returns in. Read from the
    // stock ledger rather than from documents, because the point of sale keeps its lines in a JSON
    // column and the ledger is the one place where every sale — invoiced or rung up — lands with a
    // product, a warehouse and a date.
    await q.query(`
      CREATE OR REPLACE VIEW "ai_src_daily_demand" WITH (security_invoker = true) AS
      SELECT
        m."organization_id",
        m."product_id",
        m."warehouse_id",
        w."branch_id",
        (m."date")::date AS "day",
        SUM(CASE WHEN m."type" = 'SALE_DISPATCH' THEN -m."quantity" ELSE 0 END) AS "qty_sold",
        SUM(CASE WHEN m."type" = 'SALE_RETURN' THEN m."quantity" ELSE 0 END) AS "qty_returned",
        SUM(CASE WHEN m."type" = 'SALE_DISPATCH' THEN -m."quantity" * m."cost" ELSE 0 END) AS "cost_sold"
      FROM "stock_movements" m
      JOIN "warehouses" w ON w."id" = m."warehouse_id"
      WHERE m."type" IN ('SALE_DISPATCH', 'SALE_RETURN')
      GROUP BY m."organization_id", m."product_id", m."warehouse_id", w."branch_id", (m."date")::date
    `);
    // Net movement per day, of every kind — enough, with today's balance, to rebuild the on-hand
    // quantity of any past day and therefore to know which days a product was out of stock.
    await q.query(`
      CREATE OR REPLACE VIEW "ai_src_stock_daily_net" WITH (security_invoker = true) AS
      SELECT
        m."organization_id",
        m."product_id",
        m."warehouse_id",
        (m."date")::date AS "day",
        SUM(m."quantity") AS "net_quantity"
      FROM "stock_movements" m
      GROUP BY m."organization_id", m."product_id", m."warehouse_id", (m."date")::date
    `);
    // Supplier lead time, per receipt: from the order date to the day the goods arrived.
    await q.query(`
      CREATE OR REPLACE VIEW "ai_src_lead_times" WITH (security_invoker = true) AS
      SELECT
        r."organization_id",
        l."product_id",
        r."warehouse_id",
        o."supplier_id",
        o."order_date",
        (r."received_at")::date AS "received_on",
        GREATEST(((r."received_at")::date - o."order_date"), 0) AS "lead_time_days"
      FROM "purchase_order_receipts" r
      JOIN "purchase_orders" o ON o."id" = r."order_id"
      JOIN "purchase_order_lines" l ON l."order_id" = o."id"
      WHERE r."voided_at" IS NULL AND l."product_id" IS NOT NULL
    `);

    // ── The engine's role ─────────────────────────────────────────────────────────
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_ai_engine') THEN
          CREATE ROLE virtex_ai_engine LOGIN NOBYPASSRLS;
        END IF;
      END
      $$;
    `);
    // Same reasoning as `virtex_app`: no password means unreachable over TCP, which is the safe
    // default. A deployment that runs the engine sets AI_ENGINE_DB_PASSWORD before migrating.
    const enginePassword = process.env['AI_ENGINE_DB_PASSWORD'];
    if (enginePassword) {
      await q.query(
        `ALTER ROLE virtex_ai_engine WITH PASSWORD '${enginePassword.replace(/'/g, "''")}'`,
      );
    }
    await q.query(`GRANT USAGE ON SCHEMA public TO virtex_ai_engine`);
    // Read: the views, and the tables under them (a security-invoker view reads as its caller).
    await q.query(`
      GRANT SELECT ON
        "ai_src_daily_demand", "ai_src_stock_daily_net", "ai_src_lead_times",
        "stock_movements", "stock_levels", "warehouses", "branches", "products",
        "product_categories", "purchase_orders", "purchase_order_receipts", "purchase_order_lines",
        "invoices", "invoice_line_item", "pos_sales", "vendor_bills", "organizations"
      TO virtex_ai_engine
    `);
    // Write: only what the engine produces.
    await q.query(`GRANT SELECT, UPDATE ON "ai_model_runs" TO virtex_ai_engine`);
    // What people said about past findings: the engine quietens a detector a tenant keeps dismissing.
    await q.query(`GRANT SELECT ON "ai_anomaly_feedback" TO virtex_ai_engine`);
    await q.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_forecasts", "ai_inventory_insights", "ai_anomalies" TO virtex_ai_engine`,
    );

    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON
            "product_images", "ai_requests", "ai_model_runs", "ai_forecasts",
            "ai_inventory_insights", "ai_anomalies", "ai_anomaly_feedback"
          TO virtex_app;
          GRANT SELECT ON "ai_src_daily_demand", "ai_src_stock_daily_net", "ai_src_lead_times"
          TO virtex_app;
        END IF;
      END
      $$;
    `);
    if (vectorAvailable) {
      await q.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON "product_embeddings" TO virtex_app;
          END IF;
        END
        $$;
      `);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP VIEW IF EXISTS "ai_src_lead_times"`);
    await q.query(`DROP VIEW IF EXISTS "ai_src_stock_daily_net"`);
    await q.query(`DROP VIEW IF EXISTS "ai_src_daily_demand"`);
    await q.query(`DROP TABLE IF EXISTS "product_embeddings"`);
    await q.query(`DROP TABLE IF EXISTS "ai_anomaly_feedback"`);
    await q.query(`DROP TABLE IF EXISTS "ai_anomalies"`);
    await q.query(`DROP TABLE IF EXISTS "ai_inventory_insights"`);
    await q.query(`DROP TABLE IF EXISTS "ai_forecasts"`);
    await q.query(`DROP TABLE IF EXISTS "ai_model_runs"`);
    await q.query(`DROP TABLE IF EXISTS "ai_requests"`);
    await q.query(`DROP TABLE IF EXISTS "product_images"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_products_organization_barcode"`);
    await q.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "attributes"`);
    await q.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "brand"`);
    await q.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "barcode"`);
    // `ai_credits` stays in the plan enums: PostgreSQL cannot drop an enum value, and an unused
    // value is harmless.
    // The role is left in place: it may own a password a deployment set, and dropping a role that
    // still holds grants elsewhere fails. Revoking is enough to make it inert.
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_ai_engine') THEN
          REVOKE ALL ON ALL TABLES IN SCHEMA public FROM virtex_ai_engine;
        END IF;
      END
      $$;
    `);
  }
}
