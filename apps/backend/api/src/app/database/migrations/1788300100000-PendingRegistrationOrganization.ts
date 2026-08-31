import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Record which organization a signup produced, so completion is a fact rather than an inference.
 *
 * `completePendingRegistration` decided whether it had already run by looking up `users` by
 * email: a user with that address meant "done". That works only while one email can own exactly
 * one tenant, and it stops working the moment an existing customer registers a second company —
 * the lookup finds their first account, the method returns it, and the organization they just
 * paid for is never created. Silently, after the charge.
 *
 * Keying idempotency on this column asks the right question: has THIS signup produced its
 * organization? The backfill answers it for rows that completed before the column existed, by
 * matching the account that was created from them.
 */
export class PendingRegistrationOrganization1788300100000 implements MigrationInterface {
  name = 'PendingRegistrationOrganization1788300100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pending_registrations"
        ADD COLUMN IF NOT EXISTS "organization_id" uuid
    `);

    // Historic rows: a completed signup owned exactly one tenant, reachable through the user it
    // created. Left null where that user no longer exists, which is the honest answer.
    await queryRunner.query(`
      UPDATE "pending_registrations" pr
         SET "organization_id" = u."organization_id"
        FROM "users" u
       WHERE u."email" = pr."email"
         AND pr."status" = 'completed'
         AND pr."organization_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pending_registrations_organization_id"
        ON "pending_registrations" ("organization_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_pending_registrations_organization_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_registrations" DROP COLUMN IF EXISTS "organization_id"`,
    );
  }
}
