import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Procurement, stock and HR master data belong to their tenant by constraint, not just by column.
 *
 * ## What was wrong
 *
 * `purchase_orders`, `purchase_requisitions`, `product_categories` and `departments` carry an
 * `organization_id` that nothing enforced, and the tables added for goods receipts
 * (`purchase_order_receipts`, `stock_movements.organization_id`) followed the same pattern.
 * Deleting a tenant — offboarding, a privacy-erasure request, a trial clean-up — therefore:
 *
 * - left every one of these rows behind, owned by a tenant that no longer exists and visible to no
 *   row-level-security policy, so nobody could ever see or remove them; and
 * - failed outright for any tenant that had placed a purchase order, because
 *   `purchase_orders.supplier_id` was `RESTRICT` and the tenant's suppliers DO cascade away.
 *
 * ## What changes
 *
 * - Each table gains `organization_id → organizations ON DELETE CASCADE`.
 * - The references that exist to stop master data being deleted out from under a document —
 *   an order's supplier, a movement's product, a product's category — become
 *   `NO ACTION DEFERRABLE INITIALLY DEFERRED`: still refused when the supplier, product or category
 *   is deleted on its own, checked at COMMIT so that the tenant's own delete, which removes both
 *   sides in one statement, is not defeated by the order PostgreSQL happens to cascade in. The
 *   same reasoning is set out in full in `ProtectReferencedMasterData1789007600000`.
 *
 * ## Existing orphans
 *
 * Rows already orphaned by earlier tenant deletions are not deleted here: a migration is not the
 * place to destroy data, even data nobody can see. Each constraint is added `NOT VALID` — enforced
 * for every new and updated row, and cascading from now on — and then validated only when no
 * orphan exists. Where one does, the constraint stays `NOT VALID` and a NOTICE names the table, so
 * an operator can review and remove the orphans and run `VALIDATE CONSTRAINT` afterwards.
 */
export class TenantOwnedProcurementAndStock1789008000000 implements MigrationInterface {
  name = 'TenantOwnedProcurementAndStock1789008000000';

  private static readonly TENANT_TABLES: ReadonlyArray<[table: string, constraint: string]> = [
    ['purchase_orders', 'FK_purchase_orders_organization'],
    ['purchase_requisitions', 'FK_purchase_requisitions_organization'],
    ['purchase_order_receipts', 'FK_purchase_order_receipts_organization'],
    ['product_categories', 'FK_product_categories_organization'],
    ['departments', 'FK_departments_organization'],
    ['stock_movements', 'FK_stock_movements_organization'],
  ];

  public async up(q: QueryRunner): Promise<void> {
    // A movement written before its tenant was stamped takes the tenant of its product.
    await q.query(`
      UPDATE "stock_movements" m
         SET "organization_id" = p."organization_id"
        FROM "products" p
       WHERE m."organization_id" IS NULL
         AND p."id" = m."product_id"
    `);

    for (const [table, constraint] of TenantOwnedProcurementAndStock1789008000000.TENANT_TABLES) {
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`);
      await q.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "${constraint}"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
          NOT VALID
      `);
      await q.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM "${table}" t
             WHERE t."organization_id" IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = t."organization_id")
          ) THEN
            RAISE NOTICE '${table}: rows reference organizations that no longer exist; "${constraint}" left NOT VALID until they are reviewed.';
          ELSE
            ALTER TABLE "${table}" VALIDATE CONSTRAINT "${constraint}";
          END IF;
        END $$;
      `);
    }

    await this.deferred(q, 'purchase_orders', 'FK_purchase_orders_supplier', 'supplier_id', 'suppliers');
    await this.deferred(q, 'products', 'FK_products_category', 'category_id', 'product_categories');
    await this.deferred(q, 'stock_movements', 'FK_2c1bb05b80ddcc562cd28d826c6', 'product_id', 'products');
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "stock_movements" DROP CONSTRAINT IF EXISTS "FK_2c1bb05b80ddcc562cd28d826c6"`);
    await q.query(`
      ALTER TABLE "stock_movements" ADD CONSTRAINT "FK_2c1bb05b80ddcc562cd28d826c6"
        FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await q.query(`ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "FK_products_category"`);
    await q.query(`
      ALTER TABLE "products" ADD CONSTRAINT "FK_products_category"
        FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await q.query(`ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "FK_purchase_orders_supplier"`);
    await q.query(`
      ALTER TABLE "purchase_orders" ADD CONSTRAINT "FK_purchase_orders_supplier"
        FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    for (const [table, constraint] of TenantOwnedProcurementAndStock1789008000000.TENANT_TABLES) {
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`);
    }
  }

  private async deferred(
    q: QueryRunner,
    table: string,
    constraint: string,
    column: string,
    references: string,
  ): Promise<void> {
    await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`);
    await q.query(`
      ALTER TABLE "${table}"
        ADD CONSTRAINT "${constraint}"
        FOREIGN KEY ("${column}") REFERENCES "${references}"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED
    `);
  }
}
