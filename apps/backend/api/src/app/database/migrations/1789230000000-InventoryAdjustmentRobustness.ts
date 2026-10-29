import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What an inventory adjustment needs to be posted safely, corrected cleanly and read in order.
 *
 * - `inventory_adjustment_lines.position`: the order the person typed the lines in. Lines came back
 *   ordered by their random UUID, so a document reopened shuffled. Existing lines keep the order
 *   they had (by id), which is the only order anyone has seen for them.
 * - `inventory_adjustment_lines.expected_quantity`: what the warehouse held when the count was
 *   taken, so posting can tell that the balance moved since and refuse to undo that movement.
 * - `inventory_adjustment_lines.quantity_value` / `revaluation_value`: the line's value split by
 *   nature, so the journal entry books shortfalls, surpluses and revaluations separately instead
 *   of netting them. Posted lines are backfilled: their whole value was quantity unless a new unit
 *   cost was set, in which case the split cannot be recovered and both stay null.
 * - `inventory_adjustments.cancelled_by_user_id` / `cancelled_at`: who voided a draft, and when.
 * - `inventory_adjustments.reverses_adjustment_id` / `reversed_by_adjustment_id`: a posted
 *   adjustment is corrected by its mirror image, and the two point at each other.
 * - `stock_movements.value`: the value the posting booked, so the kardex shows the same figure as
 *   the journal entry (and a revaluation, with quantity 0, has somewhere to put its amount).
 *
 * Additive and idempotent.
 */
export class InventoryAdjustmentRobustness1789230000000 implements MigrationInterface {
  name = 'InventoryAdjustmentRobustness1789230000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "inventory_adjustment_lines"
        ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "expected_quantity" numeric(18,6),
        ADD COLUMN IF NOT EXISTS "quantity_value" numeric(18,2),
        ADD COLUMN IF NOT EXISTS "revaluation_value" numeric(18,2)
    `);
    await q.query(`
      UPDATE "inventory_adjustment_lines" l
         SET "position" = ordered."position"
        FROM (
          SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "adjustment_id" ORDER BY "id") - 1)::int AS "position"
            FROM "inventory_adjustment_lines"
        ) ordered
       WHERE ordered."id" = l."id"
    `);
    await q.query(`
      UPDATE "inventory_adjustment_lines"
         SET "quantity_value" = "value_change", "revaluation_value" = 0
       WHERE "value_change" IS NOT NULL AND "new_unit_cost" IS NULL AND "quantity_value" IS NULL
    `);

    await q.query(`
      ALTER TABLE "inventory_adjustments"
        ADD COLUMN IF NOT EXISTS "cancelled_by_user_id" uuid,
        ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "reverses_adjustment_id" uuid,
        ADD COLUMN IF NOT EXISTS "reversed_by_adjustment_id" uuid
    `);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_inventory_adjustments_reverses') THEN
          ALTER TABLE "inventory_adjustments"
            ADD CONSTRAINT "FK_inventory_adjustments_reverses"
            FOREIGN KEY ("reverses_adjustment_id") REFERENCES "inventory_adjustments"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
        END IF;
      END $$
    `);

    await q.query(`ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "value" numeric(18,2)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "stock_movements" DROP COLUMN IF EXISTS "value"`);
    await q.query(`ALTER TABLE "inventory_adjustments" DROP CONSTRAINT IF EXISTS "FK_inventory_adjustments_reverses"`);
    await q.query(`
      ALTER TABLE "inventory_adjustments"
        DROP COLUMN IF EXISTS "reversed_by_adjustment_id",
        DROP COLUMN IF EXISTS "reverses_adjustment_id",
        DROP COLUMN IF EXISTS "cancelled_at",
        DROP COLUMN IF EXISTS "cancelled_by_user_id"
    `);
    await q.query(`
      ALTER TABLE "inventory_adjustment_lines"
        DROP COLUMN IF EXISTS "revaluation_value",
        DROP COLUMN IF EXISTS "quantity_value",
        DROP COLUMN IF EXISTS "expected_quantity",
        DROP COLUMN IF EXISTS "position"
    `);
  }
}
