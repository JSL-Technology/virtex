import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The account a stock movement lands in when it is neither a purchase nor a sale (5150, expense).
 *
 * Editing a product's on-hand quantity moved a real asset with no counterpart anywhere in the
 * ledger: the warehouse said one thing, the balance sheet another, and nothing in the books
 * explained the gap. Breakage, theft and a stock count that disagrees with the record are ordinary
 * events; they need somewhere to be recognised.
 *
 * Deliberately not cost of goods sold. A shrinkage is not a cost of what was sold, and a margin
 * computed from an account that mixes the two answers no question anyone asked.
 *
 * New tenants get it from the chart-of-accounts template. This adds it to tenants that already
 * exist, in the language their books are kept in, and points their settings at it. Idempotent.
 */
export class InventoryAdjustmentAccount1789003800000 implements MigrationInterface {
  name = 'InventoryAdjustmentAccount1789003800000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN IF NOT EXISTS "default_inventory_adjustment_account_id" uuid
    `);

    // `books_language` is null on tenants created before it existed; those were all Spanish.
    const name = `
      CASE COALESCE(o."books_language", 'es')
        WHEN 'pt' THEN jsonb_build_object('pt', 'Ajustes de Estoque')
        WHEN 'en' THEN jsonb_build_object('en', 'Inventory Adjustments')
        ELSE jsonb_build_object('es', 'Ajustes de Inventario')
      END`;

    // Hung off the same parent as cost of goods sold, so it lands in the expense group of each
    // tenant's tree rather than at the root.
    await q.query(`
      WITH inserted AS (
        INSERT INTO "accounts"
          ("name", "type", "category", "nature", "isActive", "isPostable", "isSystemAccount",
           "parent_id", "organization_id", "system_role", "version", "code")
        SELECT ${name}, 'EXPENSE'::accounts_type_enum,
               'OPERATING_EXPENSE'::accounts_category_enum, 'DEBIT'::accounts_nature_enum,
               true, true, false,
               sibling."parent_id", o."id", 'INVENTORY_ADJUSTMENT', 1, '5150'
        FROM "organizations" o
        JOIN "accounts" sibling
          ON sibling."organization_id" = o."id" AND sibling."system_role" = 'COST_OF_GOODS_SOLD'
        WHERE NOT EXISTS (
          SELECT 1 FROM "accounts" a
          WHERE a."organization_id" = o."id" AND a."system_role" = 'INVENTORY_ADJUSTMENT'
        )
        RETURNING "id"
      )
      INSERT INTO "account_segments" ("order", "value", "account_id")
      SELECT 0, '5150', "id" FROM inserted
    `);

    await q.query(`
      UPDATE "organization_settings" s
      SET "default_inventory_adjustment_account_id" = a."id"
      FROM "accounts" a
      WHERE a."organization_id" = s."organization_id"
        AND a."system_role" = 'INVENTORY_ADJUSTMENT'
        AND s."default_inventory_adjustment_account_id" IS NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "organization_settings"
        DROP COLUMN IF EXISTS "default_inventory_adjustment_account_id"
    `);
    await q.query(`
      DELETE FROM "accounts" a
      WHERE a."system_role" = 'INVENTORY_ADJUSTMENT'
        AND NOT EXISTS (
          SELECT 1 FROM "journal_entry_lines" l WHERE l."account_id" = a."id"
        )
    `);
  }
}
