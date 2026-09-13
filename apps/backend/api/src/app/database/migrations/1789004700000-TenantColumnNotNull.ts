import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `organization_id` is NOT NULL on every tenant-scoped table.
 *
 * ## What was wrong
 *
 * `BaseEntity` declared the tenant key as `nullable: true`, and sixteen of the twenty-four tables
 * built from it carried the column as nullable. A tenant-scoped row with no tenant is not a row
 * with a missing field:
 *
 *   - No row-level-security policy can see it. Every policy in this schema reads
 *     `organization_id = current_setting('app.current_organization')::uuid`, and that comparison is
 *     never true of NULL — so the row is invisible to the application, in both directions, forever.
 *   - No tenant owns it, so deleting a tenant does not cascade it away. It outlives the account it
 *     was created under, in a table the next tenant also reads.
 *   - Nothing rejects it at write time, so a service that forgets to set the tenant — a background
 *     job, a queue worker whose connection lost its context — writes a row that simply disappears
 *     instead of failing.
 *
 * The seven payroll and HCM tables that got this right did so by re-declaring the column in the
 * subclass. TypeORM does not honour a subclass column override of an inherited property, so the
 * override was inert: the metadata said nullable, the database said NOT NULL, and
 * `check:schema-drift` proposed dropping the constraint from all seven on every run.
 *
 * ## What this does
 *
 * Sets NOT NULL on the sixteen laggards, after refusing to run if any of them actually holds an
 * orphan row. It does NOT delete or reassign such rows: which tenant an orphan belongs to is a
 * question about the business, not about the schema, and guessing would be worse than stopping.
 * The message names the table and the count so an operator can look.
 */
export class TenantColumnNotNull1789004700000 implements MigrationInterface {
  name = 'TenantColumnNotNull1789004700000';

  /** Built from `BaseEntity`, and nullable before this migration. */
  private static readonly TABLES = [
    'bill_of_material_items',
    'bill_of_materials',
    'bin_locations',
    'departments',
    'landed_costs',
    'product_categories',
    'production_orders',
    'project_tasks',
    'projects',
    'purchase_order_lines',
    'purchase_orders',
    'purchase_requisition_lines',
    'purchase_requisitions',
    'supplier_portal_users',
    'timesheets',
    'warehouses',
    'work_centers',
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const table of TenantColumnNotNull1789004700000.TABLES) {
      const exists = await q.query(`SELECT to_regclass('public.${table}') IS NOT NULL AS present`);
      if (!exists[0]?.present) continue;

      const [{ orphans }] = await q.query(
        `SELECT COUNT(*)::int AS orphans FROM "${table}" WHERE "organization_id" IS NULL`,
      );
      if (orphans > 0) {
        throw new Error(
          `${table} holds ${orphans} row(s) with no organization_id. Assign them to a tenant (or ` +
            `delete them) and run this migration again — which tenant they belong to is a question ` +
            `about the business, and this migration will not guess.`,
        );
      }

      await q.query(`ALTER TABLE "${table}" ALTER COLUMN "organization_id" SET NOT NULL`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of TenantColumnNotNull1789004700000.TABLES) {
      const exists = await q.query(`SELECT to_regclass('public.${table}') IS NOT NULL AS present`);
      if (!exists[0]?.present) continue;
      await q.query(`ALTER TABLE "${table}" ALTER COLUMN "organization_id" DROP NOT NULL`);
    }
  }
}
