import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * C-2: Give every refresh token a stable session (family) identifier.
 *
 * Access tokens embed `sessionId` so the JwtStrategy can consult a revocation denylist. Keying
 * that denylist on `refresh_tokens.id` would be wrong, because a routine rotation replaces the
 * id — a rotation would be indistinguishable from a revocation.
 *
 * `session_id` is therefore the id of the *first* token in a rotation chain and is inherited by
 * every subsequent rotation.
 *
 * Backfill walks the existing `replaced_by_token` chains so tokens that were already rotated end
 * up sharing their original root, preserving session continuity across the deploy.
 *
 * The chain walk casts explicitly: `replaced_by_token` was originally declared varchar while
 * `id` is uuid, and Postgres refuses to compare the two. The column is uuid from the baseline
 * onwards, but the casts keep this migration correct against a database created before that.
 */
export class AddRefreshTokenSessionFamily1756400000000 implements MigrationInterface {
  name = 'AddRefreshTokenSessionFamily1756400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // pgcrypto/pg13+ provides gen_random_uuid(); the default lets the column be added to a
    // populated table and mirrors the entity definition so `synchronize` and migrations agree.
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
        ADD COLUMN IF NOT EXISTS "session_id" uuid DEFAULT gen_random_uuid()
    `);

    // Seed every row as its own family root.
    await queryRunner.query(`
      UPDATE "refresh_tokens" SET "session_id" = "id" WHERE "session_id" IS NULL
    `);

    // Collapse each rotation chain onto its root by walking replaced_by_token upwards.
    // Bounded by the chain depth; refresh chains are short because expired rows are pruned.
    await queryRunner.query(`
      WITH RECURSIVE chain AS (
        SELECT t."id" AS root_id, t."id" AS current_id
          FROM "refresh_tokens" t
         WHERE NOT EXISTS (
           SELECT 1 FROM "refresh_tokens" p WHERE p."replaced_by_token"::text = t."id"::text
         )
        UNION ALL
        SELECT c.root_id, r."id"
          FROM chain c
          JOIN "refresh_tokens" r ON r."id" = (
            SELECT x."replaced_by_token"::uuid FROM "refresh_tokens" x WHERE x."id" = c.current_id
          )
      )
      UPDATE "refresh_tokens" rt
         SET "session_id" = chain.root_id
        FROM chain
       WHERE rt."id" = chain.current_id
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_tokens" ALTER COLUMN "session_id" SET NOT NULL
    `);

    // The default existed only so the column could be added to a table that already had rows.
    // Every value is now set, and the application supplies session_id explicitly on every
    // insert, so the default is dropped: keeping it would hide a future bug where the family id
    // was not computed, and it would leave the live schema permanently different from the
    // entity definition.
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens" ALTER COLUMN "session_id" DROP DEFAULT
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_session"
        ON "refresh_tokens" ("session_id")
    `);

    // Supports the hot path: listing and revoking a user's live sessions.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_user_revoked"
        ON "refresh_tokens" ("user_id", "is_revoked")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_refresh_tokens_user_revoked"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_refresh_tokens_session"`);
    await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP COLUMN IF EXISTS "session_id"`);
  }
}
