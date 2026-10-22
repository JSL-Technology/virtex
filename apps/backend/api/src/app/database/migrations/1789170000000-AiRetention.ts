import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Conversations are deleted after the company's retention period; what the AI proposed is not.
 *
 * A proposal (`ai_pending_actions`) is the record of what the copilot offered to create and what
 * the person decided — what an auditor asks for. It belonged to its conversation by cascade, so
 * deleting a conversation (by the person, or by retention) erased the trail with it. The proposal
 * now outlives its conversation: the link is set null, the proposal stays.
 */
export class AiRetention1789170000000 implements MigrationInterface {
  name = 'AiRetention1789170000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ai_pending_actions" ALTER COLUMN "conversation_id" DROP NOT NULL`);
    await q.query(`ALTER TABLE "ai_pending_actions" DROP CONSTRAINT IF EXISTS "FK_ai_pending_actions_conversation"`);
    await q.query(`
      ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "FK_ai_pending_actions_conversation"
        FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_ai_conversations_org_updated" ON "ai_conversations" ("organization_id", "updated_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_ai_conversations_org_updated"`);
    await q.query(`DELETE FROM "ai_pending_actions" WHERE "conversation_id" IS NULL`);
    await q.query(`ALTER TABLE "ai_pending_actions" DROP CONSTRAINT IF EXISTS "FK_ai_pending_actions_conversation"`);
    await q.query(`
      ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "FK_ai_pending_actions_conversation"
        FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE
    `);
    await q.query(`ALTER TABLE "ai_pending_actions" ALTER COLUMN "conversation_id" SET NOT NULL`);
  }
}
