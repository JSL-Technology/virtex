import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stop treating a phone number as a platform-wide identifier.
 *
 * `users.phone` carried a global unique constraint. Nothing in the product looks an account up by
 * phone — there is no lookup by phone anywhere in the codebase, and the number is used only as a
 * destination for an OTP the user has already been authenticated to request. So the constraint
 * bought nothing, and it cost the ordinary case: two employees who share a company switchboard
 * number, which is how a large share of small businesses in these markets operate. The second one
 * to save their profile got a database error surfaced as a generic failure.
 *
 * Verification remains per user (`is_phone_verified` is set only after that user completes an
 * OTP), so two accounts holding the same number are two accounts that each proved access to it.
 */
export class DropGlobalUserPhoneUniqueness1788300300000 implements MigrationInterface {
  name = 'DropGlobalUserPhoneUniqueness1788300300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "UQ_a000cca60bcf04454e727699490"`,
    );
    // Kept as a plain index: the column is filtered on in administration screens.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_users_phone" ON "users" ("phone")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_phone"`);
    // The unique constraint is deliberately not restored: re-adding it would fail against any
    // shared number saved since, and it was never serving a purpose.
  }
}
