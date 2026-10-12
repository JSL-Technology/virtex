import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Business Workflow engine's store: definitions, their running instances, the human tasks those
 * raise, and the move-by-move history.
 *
 * All four are tenant tables — they carry `organization_id`, cascade from `organizations`, and are
 * governed by the same row-level policy as the rest of the product, so a workflow of one company is
 * never visible, resumable or completable from another. The `virtex_app` grants are what let the
 * unprivileged application role touch them at all; without them the tables exist and every query
 * fails with «permission denied».
 */
export class WorkflowEngine1789010000000 implements MigrationInterface {
  name = 'WorkflowEngine1789010000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_definition_status') THEN
          CREATE TYPE "workflow_definition_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_instance_status') THEN
          CREATE TYPE "workflow_instance_status" AS ENUM ('RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_task_status') THEN
          CREATE TYPE "workflow_task_status" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');
        END IF;
      END
      $$;
    `);

    // ── Definitions ────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "workflow_definitions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "key" varchar(120) NOT NULL,
        "name" varchar(200) NOT NULL,
        "description" text NULL,
        "version" integer NOT NULL DEFAULT 1,
        "status" "workflow_definition_status" NOT NULL DEFAULT 'DRAFT',
        "graph" jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
        "trigger" jsonb NOT NULL DEFAULT '{"mode":"manual"}',
        "created_by_user_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_definitions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_workflow_definitions_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_definitions_org_key"
        ON "workflow_definitions" ("organization_id", "key")
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_workflow_definitions_org_key_version"
        ON "workflow_definitions" ("organization_id", "key", "version")
    `);

    // ── Instances ──────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "workflow_instances" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "definition_id" uuid NOT NULL,
        "definition_version" integer NOT NULL,
        "status" "workflow_instance_status" NOT NULL DEFAULT 'RUNNING',
        "context" jsonb NOT NULL DEFAULT '{}',
        "tokens" jsonb NOT NULL DEFAULT '[]',
        "subject" jsonb NULL,
        "started_by_user_id" uuid NULL,
        "next_wake_at" timestamptz NULL,
        "error" text NULL,
        "completed_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_instances" PRIMARY KEY ("id"),
        CONSTRAINT "FK_workflow_instances_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_instances_org_status"
        ON "workflow_instances" ("organization_id", "status")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_instances_org_wake"
        ON "workflow_instances" ("organization_id", "next_wake_at")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_instances_org_definition"
        ON "workflow_instances" ("organization_id", "definition_id")
    `);

    // ── Tasks ────────────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "workflow_tasks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "instance_id" uuid NOT NULL,
        "node_id" varchar(64) NOT NULL,
        "token_id" varchar(64) NOT NULL,
        "name" varchar(200) NOT NULL,
        "assignee_role_id" uuid NULL,
        "assignee_user_id" uuid NULL,
        "outcomes" jsonb NOT NULL DEFAULT '[]',
        "status" "workflow_task_status" NOT NULL DEFAULT 'OPEN',
        "outcome" varchar(64) NULL,
        "due_at" timestamptz NULL,
        "completed_by_user_id" uuid NULL,
        "completed_at" timestamptz NULL,
        "form_data" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_tasks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_workflow_tasks_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_workflow_tasks_instance" FOREIGN KEY ("instance_id")
          REFERENCES "workflow_instances"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_tasks_org_status"
        ON "workflow_tasks" ("organization_id", "status")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_tasks_org_instance"
        ON "workflow_tasks" ("organization_id", "instance_id")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_tasks_org_role"
        ON "workflow_tasks" ("organization_id", "assignee_role_id")
    `);

    // ── Transitions (history) ──────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "workflow_transitions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "instance_id" uuid NOT NULL,
        "from_node_id" varchar(64) NULL,
        "to_node_id" varchar(64) NULL,
        "kind" varchar(32) NOT NULL,
        "detail" jsonb NULL,
        "actor_user_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_transitions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_workflow_transitions_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_workflow_transitions_instance" FOREIGN KEY ("instance_id")
          REFERENCES "workflow_instances"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_transitions_org_instance"
        ON "workflow_transitions" ("organization_id", "instance_id")
    `);

    // ── Row-level security: one policy per table, keyed off the tenant setting ───
    for (const table of [
      'workflow_definitions',
      'workflow_instances',
      'workflow_tasks',
      'workflow_transitions',
    ]) {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await q.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
      `);
    }

    // ── Grants: the application role is unprivileged and sees nothing it is not granted ──
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "workflow_definitions" TO virtex_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "workflow_instances" TO virtex_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "workflow_tasks" TO virtex_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "workflow_transitions" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "workflow_transitions"`);
    await q.query(`DROP TABLE IF EXISTS "workflow_tasks"`);
    await q.query(`DROP TABLE IF EXISTS "workflow_instances"`);
    await q.query(`DROP TABLE IF EXISTS "workflow_definitions"`);
    await q.query(`DROP TYPE IF EXISTS "workflow_task_status"`);
    await q.query(`DROP TYPE IF EXISTS "workflow_instance_status"`);
    await q.query(`DROP TYPE IF EXISTS "workflow_definition_status"`);
  }
}
