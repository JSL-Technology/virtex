import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Make the email address a case-insensitive identity.
 *
 * `users.email` was a plain `varchar unique`, and PostgreSQL compares `varchar` case-sensitively,
 * so `Juan.Perez@x.com` and `juan.perez@x.com` were two distinct rows for the same person. Two
 * failures followed from that: the "already a customer, add a company" reuse path (which looks the
 * user up by exact email) could materialise — and charge — the same human twice under different
 * casing; and a customer who signed up in one case and later signed in in another was told their
 * credentials were invalid.
 *
 * The DTO layer now canonicalises every email to trimmed lower-case on the way in. This migration
 * brings the existing rows into that same form and adds a unique index on `LOWER(email)` so the
 * database enforces the invariant even against a write that bypasses the application (raw SQL, a
 * future service, a bulk import).
 *
 * If two rows already differ only by case, lower-casing them would collide. That is a genuine
 * duplicate identity a machine must not silently merge — one of them may own data, a subscription,
 * a tenant — so the migration stops and names the addresses for an operator to resolve by hand,
 * rather than picking a winner.
 */
export class CanonicalizeUserEmail1788700700000 implements MigrationInterface {
  name = 'CanonicalizeUserEmail1788700700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Refuse to proceed if collapsing case would collapse two real accounts into one.
    const collisions: Array<{ email_lower: string; count: string }> = await queryRunner.query(`
      SELECT LOWER(TRIM(email)) AS email_lower, COUNT(*) AS count
      FROM "users"
      GROUP BY LOWER(TRIM(email))
      HAVING COUNT(*) > 1
    `);

    if (collisions.length > 0) {
      const list = collisions.map((c) => `${c.email_lower} (${c.count})`).join(', ');
      throw new Error(
        `CanonicalizeUserEmail: refusing to run. These addresses exist under more than one case ` +
          `and would merge into one row: ${list}. Merge or rename these accounts manually, then ` +
          `re-run the migration.`,
      );
    }

    // 2. Bring existing rows into the canonical form the DTOs now write.
    await queryRunner.query(`UPDATE "users" SET email = LOWER(TRIM(email)) WHERE email <> LOWER(TRIM(email))`);

    // 3. Enforce case-insensitive uniqueness at the database, independent of the application.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_email_lower" ON "users" (LOWER(email))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The data is deliberately NOT un-lowercased: the original mixed casing is not recoverable and
    // was never meaningful. Only the enforcing index is removed.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_email_lower"`);
  }
}
