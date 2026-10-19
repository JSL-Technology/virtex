import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A way out of a lockout that does not depend on waiting (QA C-09).
 *
 * After too many failed sign-ins the account locks for a while. The owner was told nothing — the
 * reply was "incorrect email or password" even with the right password — and had no way to get
 * back in before the window ran out. They now receive an email with a single-use link that lifts
 * the lock; this is where its token lives.
 *
 * Stored hashed, exactly like `password_reset_token`: the token is 256 random bits, so a plain
 * SHA-256 is the right lookup key, and a database read never yields a usable link.
 */
export class AccountUnlockToken1789010210000 implements MigrationInterface {
  name = 'AccountUnlockToken1789010210000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "user_security"
        ADD COLUMN IF NOT EXISTS "unlock_token" character varying(64),
        ADD COLUMN IF NOT EXISTS "unlock_token_expires" TIMESTAMP WITH TIME ZONE
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_security_unlock_token" ON "user_security" ("unlock_token") WHERE "unlock_token" IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_user_security_unlock_token"`);
    await q.query(`
      ALTER TABLE "user_security"
        DROP COLUMN IF EXISTS "unlock_token_expires",
        DROP COLUMN IF EXISTS "unlock_token"
    `);
  }
}
