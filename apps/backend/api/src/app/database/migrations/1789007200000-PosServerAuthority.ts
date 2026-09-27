import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The till's ledger is the server's, not the browser's.
 *
 *  - `pos_sales."cashierId"`: who rang the sale. A sale used to record the terminal and nothing
 *    about the person, so a shift's takings could not be attributed to anyone.
 *  - `pos_shifts."cashSalesTotal"`, `"expectedBalance"`, `"closingVariance"`, `"closedById"`: the
 *    cash-up. Closing a shift recorded the counted cash and compared it with nothing, so a drawer
 *    that was short closed exactly like one that balanced.
 *  - One OPEN shift per terminal, enforced by the database. The "is there already an open shift?"
 *    check ran outside any lock, so two concurrent opens both passed it and a terminal ended up with
 *    two live shifts splitting its takings. Pre-existing duplicates are closed (all but the newest)
 *    before the index is created, so the migration cannot fail on old data.
 */
export class PosServerAuthority1789007200000 implements MigrationInterface {
  name = 'PosServerAuthority1789007200000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "cashierId" uuid NULL`);
    await q.query(`
      ALTER TABLE "pos_shifts"
        ADD COLUMN IF NOT EXISTS "cashSalesTotal" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "expectedBalance" numeric(14,2) NULL,
        ADD COLUMN IF NOT EXISTS "closingVariance" numeric(14,2) NULL,
        ADD COLUMN IF NOT EXISTS "closedById" uuid NULL
    `);

    await q.query(`
      UPDATE "pos_shifts" s
         SET "status" = 'CLOSED', "closedAt" = COALESCE(s."closedAt", now())
       WHERE s."status" = 'OPEN'
         AND EXISTS (
           SELECT 1 FROM "pos_shifts" newer
            WHERE newer."status" = 'OPEN'
              AND newer."organization_id" = s."organization_id"
              AND newer."terminalId" = s."terminalId"
              AND (newer."openedAt", newer."id") > (s."openedAt", s."id")
         )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pos_shifts_open_terminal"
        ON "pos_shifts" ("organization_id", "terminalId")
        WHERE "status" = 'OPEN'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_pos_shifts_open_terminal"`);
    await q.query(`
      ALTER TABLE "pos_shifts"
        DROP COLUMN IF EXISTS "closedById",
        DROP COLUMN IF EXISTS "closingVariance",
        DROP COLUMN IF EXISTS "expectedBalance",
        DROP COLUMN IF EXISTS "cashSalesTotal"
    `);
    await q.query(`ALTER TABLE "pos_sales" DROP COLUMN IF EXISTS "cashierId"`);
  }
}
