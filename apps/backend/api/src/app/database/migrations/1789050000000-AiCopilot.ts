import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The copilot's memory: conversations, their messages, and the actions it proposed.
 *
 *  - `ai_conversations`: one per thread, owned by one user. Row-level security isolates the company;
 *    the service isolates the user (a colleague's questions are not yours to read).
 *  - `ai_messages`: the turns, stored exactly as the API returned them (thinking and tool calls
 *    included) because a later turn must replay them unchanged. `seq` orders them.
 *  - `ai_pending_actions`: a document the copilot proposed to create. Nothing is written to the
 *    business tables until the person confirms; the proposal records what was shown, who decided
 *    and what was created.
 */
export class AiCopilot1789050000000 implements MigrationInterface {
  name = 'AiCopilot1789050000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_conversations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "title" varchar(200) NOT NULL DEFAULT '',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_conversations_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_conversations_org_user_updated"
        ON "ai_conversations" ("organization_id", "user_id", "updated_at")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "seq" integer NOT NULL,
        "role" varchar(16) NOT NULL,
        "content" jsonb NOT NULL,
        "tools_used" jsonb NOT NULL DEFAULT '[]',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_messages" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_messages_conversation_seq" UNIQUE ("conversation_id", "seq"),
        CONSTRAINT "FK_ai_messages_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_messages_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "ai_conversations"("id") ON DELETE CASCADE
      )
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_pending_actions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "tool" varchar(64) NOT NULL,
        "input" jsonb NOT NULL,
        "summary" text NOT NULL,
        "preview" jsonb NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'PROPOSED',
        "result" jsonb NULL,
        "error" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "decided_at" timestamptz NULL,
        CONSTRAINT "PK_ai_pending_actions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_pending_actions_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_pending_actions_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "ai_conversations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_pending_actions_org_conversation"
        ON "ai_pending_actions" ("organization_id", "conversation_id")
    `);

    for (const table of ['ai_conversations', 'ai_messages', 'ai_pending_actions']) {
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
          GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_conversations", "ai_messages", "ai_pending_actions"
          TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ai_pending_actions"`);
    await q.query(`DROP TABLE IF EXISTS "ai_messages"`);
    await q.query(`DROP TABLE IF EXISTS "ai_conversations"`);
  }
}
