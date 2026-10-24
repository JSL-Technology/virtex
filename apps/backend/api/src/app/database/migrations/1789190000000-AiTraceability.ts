import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What the AI did to a record, and what people said about what it answered.
 *
 *  - `ai_record_provenance`: a record the AI proposed or filled — an invoice the assistant drafted,
 *    a bill read from a supplier's PDF, an order the replenishment agent raised — says so, with the
 *    model call or the confirmed proposal behind it and, for a captured bill, which fields were kept
 *    as read and which a person corrected. Until now the link existed only the other way round.
 *  - `ai_pending_actions.after_external_text`: the proposal was made in a turn that had read text
 *    written by someone outside the company (a note on a bill, a customer's name). The confirmation
 *    card says so: that is where a planted instruction would come from.
 *  - `ai_messages.sources`: the records an answer rests on (the invoices, not "list_invoices").
 *  - `ai_message_feedback`: a person rating or reporting an answer.
 *  - `ai_organization_settings.activity_monitoring`: whether the anomaly run looks at when each
 *    person works. Off until the company turns it on, having told its people.
 */
export class AiTraceability1789190000000 implements MigrationInterface {
  name = 'AiTraceability1789190000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_record_provenance" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "entity_type" varchar(48) NOT NULL,
        "entity_id" uuid NOT NULL,
        "source" varchar(24) NOT NULL,
        "user_id" uuid NULL,
        "ai_request_id" uuid NULL,
        "pending_action_id" uuid NULL,
        "agent_run_id" uuid NULL,
        "fields" jsonb NULL,
        "detail" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_record_provenance" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_record_provenance_record_source" UNIQUE ("organization_id", "entity_type", "entity_id", "source"),
        CONSTRAINT "CHK_ai_record_provenance_source" CHECK (
          "source" IN ('AI_COPILOT', 'AI_CAPTURE', 'AI_AGENT', 'AI_RECONCILIATION', 'AI_MAIL', 'AI_MCP')
        ),
        CONSTRAINT "FK_ai_record_provenance_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await q.query(`ALTER TABLE "ai_pending_actions" ADD COLUMN IF NOT EXISTS "after_external_text" boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE "ai_messages" ADD COLUMN IF NOT EXISTS "sources" jsonb NOT NULL DEFAULT '[]'`);
    await q.query(`ALTER TABLE "ai_organization_settings" ADD COLUMN IF NOT EXISTS "activity_monitoring" boolean NOT NULL DEFAULT false`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_message_feedback" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "message_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "verdict" varchar(8) NOT NULL,
        "comment" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_message_feedback" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_message_feedback_message_user" UNIQUE ("message_id", "user_id"),
        CONSTRAINT "CHK_ai_message_feedback_verdict" CHECK ("verdict" IN ('UP', 'DOWN', 'REPORT')),
        CONSTRAINT "FK_ai_message_feedback_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_message_feedback_message" FOREIGN KEY ("message_id")
          REFERENCES "ai_messages"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_ai_message_feedback_org_created" ON "ai_message_feedback" ("organization_id", "created_at")`);

    for (const table of ['ai_record_provenance', 'ai_message_feedback']) {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await q.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
      `);
    }
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_record_provenance", "ai_message_feedback" TO virtex_app;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_ai_engine') THEN
          GRANT SELECT ON "ai_organization_settings" TO virtex_ai_engine;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ai_message_feedback"`);
    await q.query(`ALTER TABLE "ai_organization_settings" DROP COLUMN IF EXISTS "activity_monitoring"`);
    await q.query(`ALTER TABLE "ai_messages" DROP COLUMN IF EXISTS "sources"`);
    await q.query(`ALTER TABLE "ai_pending_actions" DROP COLUMN IF EXISTS "after_external_text"`);
    await q.query(`DROP TABLE IF EXISTS "ai_record_provenance"`);
  }
}
