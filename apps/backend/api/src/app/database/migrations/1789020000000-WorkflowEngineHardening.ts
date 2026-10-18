import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Business Workflow, hardened for production use.
 *
 * - Definitions record who published each version and when, and who last saved a draft.
 * - Instances keep their result (the end reached), why they were cancelled, and their parent run
 *   when they were started as a subprocess.
 * - Tasks freeze what the actor sees (instructions, outcome labels, form, which outcomes need a
 *   comment), keep the decision's comment, and remember when the overdue reminder went out.
 * - The database itself now guarantees what the service already promises: at most one PUBLISHED
 *   and at most one DRAFT version per process key. Rows that already break that rule (a version
 *   published twice by a race, scattered drafts) are archived first — the newest one wins — so the
 *   unique indexes can be created on an existing database.
 */
export class WorkflowEngineHardening1789020000000 implements MigrationInterface {
  name = 'WorkflowEngineHardening1789020000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "workflow_definitions"
        ADD COLUMN IF NOT EXISTS "published_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "published_by_user_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "updated_by_user_id" uuid NULL
    `);
    await q.query(`
      UPDATE "workflow_definitions" SET "published_at" = "updated_at"
       WHERE "status" IN ('PUBLISHED', 'ARCHIVED') AND "published_at" IS NULL
    `);

    await q.query(`
      ALTER TABLE "workflow_instances"
        ADD COLUMN IF NOT EXISTS "result" varchar(200) NULL,
        ADD COLUMN IF NOT EXISTS "cancel_reason" text NULL,
        ADD COLUMN IF NOT EXISTS "parent_instance_id" uuid NULL
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_instances_org_definition"
        ON "workflow_instances" ("organization_id", "definition_id")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_instances_org_created"
        ON "workflow_instances" ("organization_id", "created_at" DESC)
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_instances_parent"
        ON "workflow_instances" ("organization_id", "parent_instance_id")
        WHERE "parent_instance_id" IS NOT NULL
    `);

    await q.query(`
      ALTER TABLE "workflow_tasks"
        ADD COLUMN IF NOT EXISTS "node_type" varchar(16) NOT NULL DEFAULT 'task',
        ADD COLUMN IF NOT EXISTS "instructions" text NULL,
        ADD COLUMN IF NOT EXISTS "outcome_labels" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "comment_required_for" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "form" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "comment" text NULL,
        ADD COLUMN IF NOT EXISTS "escalated_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "escalate_to_user_id" uuid NULL
    `);
    // Approval tasks raised before the column existed: their outcomes say what they were.
    await q.query(`
      UPDATE "workflow_tasks" SET "node_type" = 'approval'
       WHERE "node_type" = 'task' AND "outcomes" @> '["approve","reject"]'::jsonb
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_tasks_org_user"
        ON "workflow_tasks" ("organization_id", "assignee_user_id")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_tasks_org_due"
        ON "workflow_tasks" ("organization_id", "due_at")
        WHERE "status" = 'OPEN' AND "escalated_at" IS NULL
    `);

    // ── One live version and one draft per process, guaranteed by the database ───────────
    await q.query(`
      UPDATE "workflow_definitions" d SET "status" = 'ARCHIVED'
        FROM (
          SELECT id, row_number() OVER (PARTITION BY organization_id, key ORDER BY version DESC) AS rank
            FROM "workflow_definitions" WHERE "status" = 'PUBLISHED'
        ) ranked
       WHERE d.id = ranked.id AND ranked.rank > 1
    `);
    await q.query(`
      UPDATE "workflow_definitions" d SET "status" = 'ARCHIVED'
        FROM (
          SELECT id, row_number() OVER (PARTITION BY organization_id, key ORDER BY version DESC) AS rank
            FROM "workflow_definitions" WHERE "status" = 'DRAFT'
        ) ranked
       WHERE d.id = ranked.id AND ranked.rank > 1
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_workflow_definitions_one_published"
        ON "workflow_definitions" ("organization_id", "key") WHERE "status" = 'PUBLISHED'
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_workflow_definitions_one_draft"
        ON "workflow_definitions" ("organization_id", "key") WHERE "status" = 'DRAFT'
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_definitions_published_trigger"
        ON "workflow_definitions" ("organization_id", ((trigger->>'event')))
        WHERE "status" = 'PUBLISHED'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_workflow_definitions_published_trigger"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_workflow_definitions_one_draft"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_workflow_definitions_one_published"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_workflow_tasks_org_due"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_workflow_tasks_org_user"`);
    await q.query(`
      ALTER TABLE "workflow_tasks"
        DROP COLUMN IF EXISTS "escalate_to_user_id",
        DROP COLUMN IF EXISTS "escalated_at",
        DROP COLUMN IF EXISTS "comment",
        DROP COLUMN IF EXISTS "form",
        DROP COLUMN IF EXISTS "comment_required_for",
        DROP COLUMN IF EXISTS "outcome_labels",
        DROP COLUMN IF EXISTS "instructions",
        DROP COLUMN IF EXISTS "node_type"
    `);
    await q.query(`DROP INDEX IF EXISTS "IDX_workflow_instances_parent"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_workflow_instances_org_created"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_workflow_instances_org_definition"`);
    await q.query(`
      ALTER TABLE "workflow_instances"
        DROP COLUMN IF EXISTS "parent_instance_id",
        DROP COLUMN IF EXISTS "cancel_reason",
        DROP COLUMN IF EXISTS "result"
    `);
    await q.query(`
      ALTER TABLE "workflow_definitions"
        DROP COLUMN IF EXISTS "updated_by_user_id",
        DROP COLUMN IF EXISTS "published_by_user_id",
        DROP COLUMN IF EXISTS "published_at"
    `);
  }
}
