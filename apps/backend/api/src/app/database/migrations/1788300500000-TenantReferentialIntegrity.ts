import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Make "belongs to a tenant" a fact the database enforces.
 *
 * Five tables carried an `organization_id` with no foreign key behind it: `roles`,
 * `saas_usage_metrics`, `identity_providers`, `organization_domains` and
 * `pending_registrations`. Every one of them is load-bearing for the modules that decide who may
 * sign in and what they are entitled to, and in every one of them the column was a bare uuid that
 * nothing checked.
 *
 * What that cost, measured rather than supposed. On the development database 52 of the 56 rows in
 * `roles` named an organization that no longer existed — the authorization table was 93% orphans,
 * accumulated silently every time a tenant was removed. `organization_domains.domain` is globally
 * unique, so a claim stranded by a deleted tenant holds that domain against every future customer
 * with nobody left to release it. `identity_providers` is a federation trust; one outliving its
 * tenant is a configured login path into an account that is gone. `pending_registrations` holds an
 * applicant's argon2 hash, their fiscal identity and their address, with no reason to survive the
 * account it produced.
 *
 * `saas_usage_metrics.organization_id` was worse than unconstrained — it was the only tenant
 * reference in the schema stored as `character varying`, because the entity declared the column
 * with no type and TypeORM inferred one from the TypeScript `string`. The unique index over
 * `(organization_id, resource, period)` is what enforces plan limits, and text comparison is not
 * UUID comparison: two spellings of one identifier are one row under `uuid` and two rows under
 * `varchar`, which is a tenant metered twice, each half comfortably under its limit. The column is
 * converted in place with `USING`, not dropped and re-added — TypeORM's own generator proposed
 * exactly that drop, which would have discarded every usage counter in the table.
 *
 * `audit_logs.organization_id` is deliberately left alone. An audit trail that disappears with the
 * tenant it describes is not an audit trail.
 */
export class TenantReferentialIntegrity1788300500000 implements MigrationInterface {
  name = 'TenantReferentialIntegrity1788300500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------------------------------------
    // Orphans first: a foreign key cannot be added over rows that already violate it.
    // ---------------------------------------------------------------------------------------
    await queryRunner.query(`
      DELETE FROM "roles" r
       WHERE r."organization_id" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = r."organization_id")
    `);
    await queryRunner.query(`
      DELETE FROM "identity_providers" p
       WHERE NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = p."organization_id")
    `);
    await queryRunner.query(`
      DELETE FROM "organization_domains" d
       WHERE NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = d."organization_id")
    `);
    await queryRunner.query(`
      UPDATE "pending_registrations" pr
         SET "organization_id" = NULL
       WHERE pr."organization_id" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = pr."organization_id")
    `);

    // ---------------------------------------------------------------------------------------
    // The metering column: convert in place, keeping the counters.
    //
    // A value that is not a well-formed UUID cannot be cast and cannot belong to any tenant, so
    // it is removed first rather than failing the migration on data that was never usable.
    // ---------------------------------------------------------------------------------------
    await queryRunner.query(`
      DELETE FROM "saas_usage_metrics"
       WHERE "organization_id" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    `);
    await queryRunner.query(`
      DELETE FROM "saas_usage_metrics" m
       WHERE NOT EXISTS (
         SELECT 1 FROM "organizations" o WHERE o."id" = m."organization_id"::uuid
       )
    `);
    // Dropping the unique index first: converting the column underneath it would otherwise
    // rebuild it against the old collation semantics.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ef530e7ba5a479071e766211ee"`);
    await queryRunner.query(`
      ALTER TABLE "saas_usage_metrics"
        ALTER COLUMN "organization_id" TYPE uuid USING "organization_id"::uuid
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_ef530e7ba5a479071e766211ee"
        ON "saas_usage_metrics" ("organization_id", "resource", "period")
    `);

    // ---------------------------------------------------------------------------------------
    // The constraints. Names match what TypeORM derives from the entity relations, so
    // `check:schema-drift` sees one object rather than two.
    // ---------------------------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "roles" ADD CONSTRAINT "FK_c328a1ecd12a5f153a96df4509e"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "saas_usage_metrics" ADD CONSTRAINT "FK_ee3a09fcd671d5a8b465098e05c"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "organization_domains" ADD CONSTRAINT "FK_a21225185191ef9e3772dc04e8f"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "pending_registrations" ADD CONSTRAINT "FK_483d739f056a5d25cc4cda57dc6"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "identity_providers" ADD CONSTRAINT "FK_3739c8f28b4116fc8e84f0ce845"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "identity_providers" DROP CONSTRAINT IF EXISTS "FK_3739c8f28b4116fc8e84f0ce845"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_registrations" DROP CONSTRAINT IF EXISTS "FK_483d739f056a5d25cc4cda57dc6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organization_domains" DROP CONSTRAINT IF EXISTS "FK_a21225185191ef9e3772dc04e8f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "saas_usage_metrics" DROP CONSTRAINT IF EXISTS "FK_ee3a09fcd671d5a8b465098e05c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "FK_c328a1ecd12a5f153a96df4509e"`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ef530e7ba5a479071e766211ee"`);
    await queryRunner.query(`
      ALTER TABLE "saas_usage_metrics"
        ALTER COLUMN "organization_id" TYPE character varying USING "organization_id"::text
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_ef530e7ba5a479071e766211ee"
        ON "saas_usage_metrics" ("organization_id", "resource", "period")
    `);
    // The deleted orphans are deliberately not restored: they referenced tenants that do not
    // exist, and re-creating them would only re-break the constraint this migration adds.
  }
}
