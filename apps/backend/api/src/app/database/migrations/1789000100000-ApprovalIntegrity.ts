import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The approval chain becomes a record, and gains the column segregation of duties needs.
 *
 * ## What the table could not answer
 *
 * `approval_requests` recorded a single `approvedByUserId`, written only when the LAST step was
 * granted. In a two- or three-step policy — the entire reason to have steps — the intermediate
 * approvers left no trace: not who, not when, not on which step. A rejection recorded less still:
 * `WorkflowsService.reject` took no user at all, so refusing a document was attributable to nobody.
 *
 * And it did not record who *raised* the request, which is why the product had no segregation of
 * duties: with no submitter stored, nothing could compare submitter against approver, and a user
 * holding the step's role composed a journal entry and approved their own entry. That is the one
 * control an approval chain exists to provide.
 *
 * ## What is added
 *
 * `approval_step_actions`, one row per decision per step, written in the same transaction as the
 * decision; `requested_by_user_id` and the submitted `amount` on the request; the rejection's
 * author and timestamp; and the two indexes every read of the table needed and did not have.
 */
export class ApprovalIntegrity1789000100000 implements MigrationInterface {
  name = 'ApprovalIntegrity1789000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "approval_requests"
        ADD COLUMN IF NOT EXISTS "requested_by_user_id" uuid,
        ADD COLUMN IF NOT EXISTS "amount" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "rejected_by_user_id" uuid,
        ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_approval_requests_org_status"
      ON "approval_requests" ("organizationId", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_approval_requests_document"
      ON "approval_requests" ("organizationId", "documentType", "documentId")
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "approval_step_actions_decision_enum" AS ENUM ('APPROVED', 'REJECTED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "approval_step_actions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "step_order" integer NOT NULL,
        "role_id" uuid,
        "actor_user_id" uuid NOT NULL,
        "decision" "approval_step_actions_decision_enum" NOT NULL,
        "comment" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_approval_step_actions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "approval_step_actions"
        DROP CONSTRAINT IF EXISTS "FK_approval_step_actions_request"
    `);
    await queryRunner.query(`
      ALTER TABLE "approval_step_actions"
        ADD CONSTRAINT "FK_approval_step_actions_request"
        FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_approval_step_actions_request"
      ON "approval_step_actions" ("request_id")
    `);

    // Backfill what can be known: the final approval already on the request becomes its own row, so
    // the history of documents approved before this migration is not simply empty.
    await queryRunner.query(`
      INSERT INTO "approval_step_actions"
        ("request_id", "organization_id", "step_order", "actor_user_id", "decision", "created_at")
      SELECT r."id", r."organizationId"::uuid, r."currentStep", r."approvedByUserId", 'APPROVED',
             COALESCE(r."approvedAt", now())
      FROM "approval_requests" r
      WHERE r."approvedByUserId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "approval_step_actions" a WHERE a."request_id" = r."id"
        )
    `);

    // The steps of a policy are traversed in `order`; two steps sharing one makes the traversal
    // depend on row order, which is not a chain.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_approval_policy_steps_policy_order"
      ON "approval_policy_steps" ("policyId", "order")
      WHERE "policyId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_approval_policy_steps_policy_order"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "approval_step_actions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "approval_step_actions_decision_enum"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_approval_requests_document"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_approval_requests_org_status"`);
    await queryRunner.query(`
      ALTER TABLE "approval_requests"
        DROP COLUMN IF EXISTS "rejected_at",
        DROP COLUMN IF EXISTS "rejected_by_user_id",
        DROP COLUMN IF EXISTS "amount",
        DROP COLUMN IF EXISTS "requested_by_user_id"
    `);
  }
}
