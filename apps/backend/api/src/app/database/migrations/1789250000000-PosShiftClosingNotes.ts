import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Why a till closed over or short (QA R3-B09).
 *
 * A shift closed 475 over with nothing asked: the variance was recorded and logged, and nobody
 * could later say whether it was a miscount, a sale rung on another till or change not given. A
 * shift whose count differs from what was expected now carries the cashier's explanation.
 */
export class PosShiftClosingNotes1789250000000 implements MigrationInterface {
  name = 'PosShiftClosingNotes1789250000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "closing_notes" varchar(500)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "pos_shifts" DROP COLUMN IF EXISTS "closing_notes"`);
  }
}
