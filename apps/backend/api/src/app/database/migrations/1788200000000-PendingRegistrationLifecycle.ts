import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Give a pending registration a lifecycle, and give its personal data an end date.
 *
 * ## Why `failure_reason` and `orphaned_subscription_id` exist
 *
 * Signup is payment-first: Stripe charges the customer and only then is the account created. When
 * that creation failed — a duplicate email, a tax-id collision against the unique index on
 * `(tax_id, fiscal_region_id)`, a plan slug that no longer resolves — the transaction rolled back
 * and the row stayed `pending`, indistinguishable from a checkout the visitor simply abandoned.
 * The customer was charged, had no account, could not sign in, and nothing anywhere recorded that
 * it had happened. These two columns plus the new `failed` status are what turn that into a
 * queue somebody can work: what broke, and which subscription is now unattached.
 *
 * ## Why the index on `expires_at` exists
 *
 * `expires_at` was written on every row and read by nothing. No lookup checked it and no job
 * purged by it, so a table holding a name, an email address, a phone number, a national tax
 * identifier, a full fiscal address and an Argon2 password hash — for people who never became
 * customers — grew without bound and without a retention limit. That is a data-minimisation and
 * retention failure under the GDPR, Brazil's LGPD and the Dominican Republic's Ley 172-13 alike.
 * `PendingRegistrationCleanupService` now sweeps by this column hourly, and the index is what
 * keeps that sweep from being a sequential scan.
 *
 * Both changes are additive and reversible; no existing row's meaning changes.
 */
export class PendingRegistrationLifecycle1788200000000 implements MigrationInterface {
  name = 'PendingRegistrationLifecycle1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pending_registrations"
        ADD COLUMN IF NOT EXISTS "failure_reason" character varying(500)
    `);
    await queryRunner.query(`
      ALTER TABLE "pending_registrations"
        ADD COLUMN IF NOT EXISTS "orphaned_subscription_id" character varying
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pending_registrations_expires_at"
        ON "pending_registrations" ("expires_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_pending_registrations_expires_at"`);
    await queryRunner.query(
      `ALTER TABLE "pending_registrations" DROP COLUMN IF EXISTS "orphaned_subscription_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_registrations" DROP COLUMN IF EXISTS "failure_reason"`,
    );
  }
}
