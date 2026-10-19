import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Charts the copilot drew (`ai_charts`). A chart keeps the recipe it was drawn from — which read
 * tool, with which input, which fields of its result — besides the figures it showed, so one the
 * person pins to the dashboard is drawn again from the live data each time, as the person viewing
 * it, rather than repeating last month's numbers.
 *
 * A pinned chart outlives the conversation it came from: the conversation is set null, not cascaded.
 */
export class AiCharts1789130000000 implements MigrationInterface {
  name = 'AiCharts1789130000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_charts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "conversation_id" uuid NULL,
        "title" varchar(120) NOT NULL,
        "chart_type" varchar(16) NOT NULL,
        "source_tool" varchar(64) NOT NULL,
        "source_input" jsonb NOT NULL DEFAULT '{}',
        "mapping" jsonb NOT NULL,
        "snapshot" jsonb NOT NULL,
        "pinned_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_charts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_ai_charts_type" CHECK ("chart_type" IN ('line', 'area', 'column', 'bar', 'pie')),
        CONSTRAINT "FK_ai_charts_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_charts_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "ai_conversations"("id") ON DELETE SET NULL
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_ai_charts_org_conversation" ON "ai_charts" ("organization_id", "conversation_id")`);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_charts_org_user_pinned"
        ON "ai_charts" ("organization_id", "user_id", "pinned_at") WHERE "pinned_at" IS NOT NULL
    `);
    await q.query(`ALTER TABLE "ai_charts" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "ai_charts" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "ai_charts"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "ai_charts"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_charts" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ai_charts"`);
  }
}
