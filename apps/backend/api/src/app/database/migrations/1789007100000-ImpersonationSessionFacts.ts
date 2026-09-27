import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Keeps the facts of an impersonated session on the server, where a token rotation cannot drop
 * them.
 *
 * An impersonation used to be recorded only in the access and refresh tokens' claims
 * (`isImpersonating`, `originalUserId`). The refresh path rebuilt the claims from scratch, and
 * after the first rotation the session was an ordinary one of the operator acting as the target:
 * renewable for a month, invisible as an impersonation in the audit trail, impossible to end with
 * "stop impersonating", and free to move into any other tenant the target belonged to.
 *
 * `impersonator_id` and `impersonation_organization_id` are written when the session starts and
 * copied to every row of the family on rotation. A rotation also re-checks that the operator is
 * still an active account, so blocking the operator ends every session they opened as someone else.
 */
export class ImpersonationSessionFacts1789007100000 implements MigrationInterface {
  name = 'ImpersonationSessionFacts1789007100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "refresh_tokens"
        ADD COLUMN IF NOT EXISTS "impersonator_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "impersonation_organization_id" uuid NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "refresh_tokens"
        DROP COLUMN IF EXISTS "impersonation_organization_id",
        DROP COLUMN IF EXISTS "impersonator_id"
    `);
  }
}
