import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Scope customer uniqueness to the tenant that owns the customer.
 *
 * `customers.email` and `customers.taxId` carried PLATFORM-WIDE unique constraints on a table
 * whose every row belongs to one `organization_id`. That is wrong in two directions at once:
 *
 *   - functionally, two tenants could not both have the same customer. In these markets that is
 *     the normal case, not an edge one — a distributor and a competitor invoice the same
 *     supermarket chain, and whichever typed the RNC second was refused with a conflict;
 *   - as a disclosure, the conflict was an oracle. Any tenant could probe a tax id or an email
 *     and learn from the 409 that some other tenant already had that customer on its books.
 *
 * `organizations` had already been corrected to a composite `(tax_id, fiscal_region_id)` index;
 * this applies the same reasoning where it was missed.
 *
 * The tax-id index is partial (`WHERE "taxId" IS NOT NULL`) so the many customers recorded
 * without one do not collide with each other.
 */
export class TenantScopedCustomerUniqueness1788300200000 implements MigrationInterface {
  name = 'TenantScopedCustomerUniqueness1788300200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "UQ_8536b8b85c06969f84f0c098b03"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "UQ_43480664949f35dcd831f805e45"`,
    );

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customers_org_email"
        ON "customers" ("organization_id", "email")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customers_org_tax_id"
        ON "customers" ("organization_id", "taxId")
        WHERE "taxId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_customers_org_email"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_customers_org_tax_id"`);
    // The platform-wide constraints are deliberately NOT restored: re-adding them would fail on
    // any data created since, and they were incorrect to begin with.
  }
}
