import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets an organization require a second factor of its members.
 *
 * ## Why this column did not exist, and why that mattered
 *
 * Whether a person holds a second factor lived only in `user_security.is_two_factor_enabled`, set
 * by that person for themselves. There was no way for a tenant to require it — so a product that
 * holds payroll, treasury and the general ledger offered MFA as a personal preference and nothing
 * more. Every customer with a security questionnaire asks for exactly this, and every framework
 * that governs financial data (SOC 2 CC6.1, PCI DSS 8.4, ISO 27001 A.9.4.2) expects the
 * organization, not the individual, to decide.
 *
 * ## Default off, deliberately
 *
 * Turning this on interrupts the next sign-in of every member who has not enrolled. That is the
 * intended behaviour and it is not something a migration should do to an existing tenant on its
 * operator's behalf, so the column ships `false` and an administrator turns it on.
 *
 * ## How it is enforced
 *
 * At sign-in. A member without a second factor still receives a session — refusing outright would
 * be a lockout, because enrolling requires being signed in — but the token carries
 * `mfaEnrolmentRequired`, and `MfaEnrolmentGuard` refuses every route except enrolment and sign-out.
 */
export class OrganizationRequireMfa1789006400000 implements MigrationInterface {
  name = 'OrganizationRequireMfa1789006400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN IF NOT EXISTS "require_mfa" boolean NOT NULL DEFAULT false
    `);

    // The application role owns nothing, so a column added later is covered by the table grant it
    // already holds — but a fresh deployment that runs migrations as a different role than the one
    // that created the table would not be. Re-granting is idempotent and costs nothing.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "organization_settings" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "require_mfa"`);
  }
}
