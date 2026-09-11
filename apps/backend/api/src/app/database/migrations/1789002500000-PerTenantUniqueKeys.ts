import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Business keys are unique per tenant, not across the whole database.
 *
 * Four tables from the operational modules carried a bare column-level `UNIQUE`: a production
 * order's number, a purchase requisition's number, an employee's e-mail and a cost centre's code.
 * In a multi-tenant product that is a scaling defect with a guaranteed trigger — the first tenant
 * to book `PO-0001`, or to hire `ana@acme.com`, reserved that value for **every** tenant, and the
 * second customer to try was refused by a database constraint with no application error to explain
 * it. A consultant on two payrolls, or the identical starting order number two companies both use,
 * were impossible to represent.
 *
 * Each global constraint is replaced with a composite unique index over `(organization_id, key)`,
 * declared on the entity as well so the schema-drift check keeps them in step. The constraint names
 * are the ones the baseline generated; the index names match the `@Index(...)` on each entity.
 *
 * These tables are empty in practice — the modules had no controller until now — so no data has to
 * be reconciled before the constraint tightens from global to per-tenant.
 */
export class PerTenantUniqueKeys1789002500000 implements MigrationInterface {
  name = 'PerTenantUniqueKeys1789002500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // production_orders.orderNumber → (organization_id, orderNumber)
    await queryRunner.query(
      `ALTER TABLE "production_orders" DROP CONSTRAINT IF EXISTS "UQ_de6985f5e09e50407ea221c6e22"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_production_orders_org_order_number" ON "production_orders" ("organization_id", "orderNumber")`,
    );

    // purchase_requisitions.number → (organization_id, number)
    await queryRunner.query(
      `ALTER TABLE "purchase_requisitions" DROP CONSTRAINT IF EXISTS "UQ_5edac4665f01836e2846d002cbb"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_purchase_requisitions_org_number" ON "purchase_requisitions" ("organization_id", "number")`,
    );

    // employees.email → (organization_id, email)
    await queryRunner.query(
      `ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS "UQ_765bc1ac8967533a04c74a9f6af"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_employees_org_email" ON "employees" ("organization_id", "email")`,
    );

    // cost_centers.code → (organizationId, code). This table stores organization_id as the
    // camelCase "organizationId" column (a schema inconsistency the RLS migration documents).
    await queryRunner.query(
      `ALTER TABLE "cost_centers" DROP CONSTRAINT IF EXISTS "UQ_65430a1f13f0bd89fb211401373"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_cost_centers_org_code" ON "cost_centers" ("organizationId", "code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cost_centers_org_code"`);
    await queryRunner.query(
      `ALTER TABLE "cost_centers" ADD CONSTRAINT "UQ_65430a1f13f0bd89fb211401373" UNIQUE ("code")`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_employees_org_email"`);
    await queryRunner.query(
      `ALTER TABLE "employees" ADD CONSTRAINT "UQ_765bc1ac8967533a04c74a9f6af" UNIQUE ("email")`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_purchase_requisitions_org_number"`);
    await queryRunner.query(
      `ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "UQ_5edac4665f01836e2846d002cbb" UNIQUE ("number")`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_production_orders_org_order_number"`);
    await queryRunner.query(
      `ALTER TABLE "production_orders" ADD CONSTRAINT "UQ_de6985f5e09e50407ea221c6e22" UNIQUE ("orderNumber")`,
    );
  }
}
