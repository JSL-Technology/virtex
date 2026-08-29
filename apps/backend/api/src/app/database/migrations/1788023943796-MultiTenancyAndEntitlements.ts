import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Real multi-tenancy, and entitlements that cover more than two resources.
 *
 * Three changes, each closing something that was structurally impossible before:
 *
 * 1. `users.organization_id` becomes a uuid with a foreign key. It was a bare `character varying`
 *    with no constraint, so a value referencing no organization was storable and the resulting
 *    user authenticated into a tenant that did not exist.
 *
 *    TypeORM generates this change as `DROP COLUMN` followed by `ADD COLUMN uuid`, which would
 *    erase every user's tenant assignment in the database. It is written by hand as an in-place
 *    `ALTER ... TYPE uuid USING`, which preserves the values.
 *
 * 2. `user_organizations` is backfilled from `users.organization_id`. The table was created and
 *    backfilled once, long ago, and then written by nothing — so every tenant created since has no
 *    membership row, and the multi-tenancy that reads this table saw none of them.
 *
 * 3. The `SaasResource` enum grows from two values to six. Postgres enums cannot be extended in
 *    place while a column depends on them, hence the rename-create-alter-drop dance; the values
 *    are a superset of the old ones, so no row can fail to cast.
 */
export class MultiTenancyAndEntitlements1788023943796 implements MigrationInterface {
  name = 'MultiTenancyAndEntitlements1788023943796';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- users.organization_id -> uuid + FK -----------------------------------------------
    //
    // Null out anything that is not a well-formed uuid, or that references no organization,
    // BEFORE the cast: the cast would fail on the first such row and take the whole deploy with
    // it. A user pointing at a non-existent tenant is already broken; making that explicit is the
    // point of the constraint.
    await queryRunner.query(`
      UPDATE "users"
         SET "organization_id" = NULL
       WHERE "organization_id" IS NOT NULL
         AND "organization_id" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    `);
    await queryRunner.query(`
      UPDATE "users" u
         SET "organization_id" = NULL
       WHERE u."organization_id" IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "organizations" o WHERE o."id"::text = u."organization_id"::text
         )
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "organization_id" TYPE uuid USING "organization_id"::uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "FK_users_organization"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
        ON DELETE SET NULL
    `);

    // --- backfill memberships --------------------------------------------------------------
    await queryRunner.query(`
      INSERT INTO "user_organizations" ("user_id", "organization_id")
      SELECT u."id", u."organization_id"
        FROM "users" u
       WHERE u."organization_id" IS NOT NULL
      ON CONFLICT DO NOTHING
    `);

    // --- metered resources -------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TYPE "public"."saas_plan_limits_resource_enum" RENAME TO "saas_plan_limits_resource_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."saas_plan_limits_resource_enum" AS ENUM('invoices', 'users', 'customers', 'suppliers', 'journal_entries', 'subsidiaries')`,
    );
    await queryRunner.query(
      `ALTER TABLE "saas_plan_limits" ALTER COLUMN "resource" TYPE "public"."saas_plan_limits_resource_enum" USING "resource"::"text"::"public"."saas_plan_limits_resource_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."saas_plan_limits_resource_enum_old"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_ef530e7ba5a479071e766211ee"`);
    await queryRunner.query(
      `ALTER TYPE "public"."saas_usage_metrics_resource_enum" RENAME TO "saas_usage_metrics_resource_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."saas_usage_metrics_resource_enum" AS ENUM('invoices', 'users', 'customers', 'suppliers', 'journal_entries', 'subsidiaries')`,
    );
    await queryRunner.query(
      `ALTER TABLE "saas_usage_metrics" ALTER COLUMN "resource" TYPE "public"."saas_usage_metrics_resource_enum" USING "resource"::"text"::"public"."saas_usage_metrics_resource_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."saas_usage_metrics_resource_enum_old"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ef530e7ba5a479071e766211ee" ON "saas_usage_metrics" ("organization_id", "resource", "period")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Usage rows for the four new resources have to go before the enum can shrink; there is no
    // value in the old enum to map them onto.
    await queryRunner.query(`
      DELETE FROM "saas_usage_metrics"
       WHERE "resource"::text NOT IN ('invoices', 'users')
    `);
    await queryRunner.query(`
      DELETE FROM "saas_plan_limits"
       WHERE "resource"::text NOT IN ('invoices', 'users')
    `);

    await queryRunner.query(`DROP INDEX "public"."IDX_ef530e7ba5a479071e766211ee"`);
    await queryRunner.query(
      `CREATE TYPE "public"."saas_usage_metrics_resource_enum_old" AS ENUM('invoices', 'users')`,
    );
    await queryRunner.query(
      `ALTER TABLE "saas_usage_metrics" ALTER COLUMN "resource" TYPE "public"."saas_usage_metrics_resource_enum_old" USING "resource"::"text"::"public"."saas_usage_metrics_resource_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."saas_usage_metrics_resource_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."saas_usage_metrics_resource_enum_old" RENAME TO "saas_usage_metrics_resource_enum"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ef530e7ba5a479071e766211ee" ON "saas_usage_metrics" ("organization_id", "resource", "period")`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."saas_plan_limits_resource_enum_old" AS ENUM('invoices', 'users')`,
    );
    await queryRunner.query(
      `ALTER TABLE "saas_plan_limits" ALTER COLUMN "resource" TYPE "public"."saas_plan_limits_resource_enum_old" USING "resource"::"text"::"public"."saas_plan_limits_resource_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."saas_plan_limits_resource_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."saas_plan_limits_resource_enum_old" RENAME TO "saas_plan_limits_resource_enum"`,
    );

    // The column goes back to varchar with its values intact — never dropped and re-added, which
    // is what the generated migration did and would have erased every tenant assignment.
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "FK_users_organization"`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "organization_id" TYPE character varying USING "organization_id"::text`,
    );
  }
}
