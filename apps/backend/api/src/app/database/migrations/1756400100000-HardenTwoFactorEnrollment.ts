import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A-5 / A-6: harden TOTP enrolment and verification.
 *
 * `pending_two_factor_secret` stages a secret while the user is still proving they can generate
 * a valid code, so starting an enrolment can no longer clobber a working one (which locked the
 * legitimate owner out of their own account).
 *
 * `last_totp_step` records the last accepted TOTP time-step so a code cannot be replayed inside
 * its validity window (NIST SP 800-63B §5.1.4.2).
 */
export class HardenTwoFactorEnrollment1756400100000 implements MigrationInterface {
  name = 'HardenTwoFactorEnrollment1756400100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_security"
        ADD COLUMN IF NOT EXISTS "pending_two_factor_secret" character varying
    `);
    await queryRunner.query(`
      ALTER TABLE "user_security"
        ADD COLUMN IF NOT EXISTS "last_totp_step" bigint
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_security" DROP COLUMN IF EXISTS "last_totp_step"`);
    await queryRunner.query(`ALTER TABLE "user_security" DROP COLUMN IF EXISTS "pending_two_factor_secret"`);
  }
}
