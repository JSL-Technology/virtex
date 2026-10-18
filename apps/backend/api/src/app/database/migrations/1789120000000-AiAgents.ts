import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents: the log of what each run did and proposed (`ai_agent_runs`), and the replenishment
 * agent's settings per company (`replenishment_agent_settings`): off by default, which warehouses,
 * how large an order it may send for approval on its own.
 */
export class AiAgents1789120000000 implements MigrationInterface {
  name = 'AiAgents1789120000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_agent_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "agent" varchar(48) NOT NULL,
        "trigger" varchar(16) NOT NULL,
        "user_id" uuid NULL,
        "status" varchar(16) NOT NULL,
        "summary" jsonb NOT NULL DEFAULT '{}',
        "proposals" jsonb NOT NULL DEFAULT '[]',
        "notes" jsonb NOT NULL DEFAULT '[]',
        "started_at" timestamptz NOT NULL,
        "finished_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_agent_runs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_ai_agent_runs_trigger" CHECK ("trigger" IN ('SCHEDULED', 'MANUAL', 'WORKFLOW')),
        CONSTRAINT "CHK_ai_agent_runs_status" CHECK ("status" IN ('SUCCEEDED', 'FAILED', 'NOTHING_TO_DO')),
        CONSTRAINT "FK_ai_agent_runs_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_agent_runs_org_agent_started"
        ON "ai_agent_runs" ("organization_id", "agent", "started_at")
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "replenishment_agent_settings" (
        "organization_id" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "warehouse_ids" jsonb NOT NULL DEFAULT '[]',
        "submit_for_approval" boolean NOT NULL DEFAULT false,
        "max_order_amount" numeric(18,2) NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_replenishment_agent_settings" PRIMARY KEY ("organization_id"),
        CONSTRAINT "CHK_replenishment_agent_settings_max" CHECK ("max_order_amount" IS NULL OR "max_order_amount" > 0),
        CONSTRAINT "FK_replenishment_agent_settings_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    for (const table of ['ai_agent_runs', 'replenishment_agent_settings']) {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await q.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
      `);
      await q.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO virtex_app;
          END IF;
        END
        $$;
      `);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "replenishment_agent_settings"`);
    await q.query(`DROP TABLE IF EXISTS "ai_agent_runs"`);
  }
}
