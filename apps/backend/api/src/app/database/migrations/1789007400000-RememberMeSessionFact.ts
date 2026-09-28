import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records "remember me" as a fact of the session family instead of re-deriving it.
 *
 * Whether a session was remembered was inferred on every rotation from how long its row had been
 * issued for (longer than 1.5 × the ordinary refresh lifetime meant "remembered"). It now decides
 * more than a cookie's lifetime — which idle window and absolute bound apply, and whether the
 * client signs out for inactivity — so it is written once, when the session begins, and inherited
 * by every rotation.
 *
 * Existing families are backfilled with the same inference that was in use, applied to each
 * family's earliest row, so no live session changes kind at deploy time.
 */
export class RememberMeSessionFact1789007400000 implements MigrationInterface {
  name = 'RememberMeSessionFact1789007400000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "refresh_tokens"
        ADD COLUMN IF NOT EXISTS "remember_me" boolean NOT NULL DEFAULT false
    `);
    await q.query(`
      UPDATE "refresh_tokens" rt
         SET "remember_me" = true
        FROM (
          SELECT DISTINCT ON ("session_id")
                 "session_id",
                 ("expiresAt" - "created_at") > interval '252 hours' AS remembered
            FROM "refresh_tokens"
           ORDER BY "session_id", "created_at" ASC
        ) first_row
       WHERE rt."session_id" = first_row."session_id"
         AND first_row.remembered
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "refresh_tokens" DROP COLUMN IF EXISTS "remember_me"`);
  }
}
