import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A structured fiscal address, and a country on the organization.
 *
 * Registration collected a single free-text `address` line and never set `country` at all, so
 * every tenant in the database had a null country while its `fiscal_region_id` said otherwise —
 * one fact with two sources, one of them always empty.
 *
 * None of the electronic-invoicing regimes these markets mandate can be satisfied from a single
 * line: CFDI 4.0 stamps a `LugarExpedicion` postal code, DIAN and SII require a coded division,
 * and United States sales tax is destination-based and undeterminable without state and ZIP.
 *
 * `company_size` was collected by the signup form and stored on the pending registration, then
 * discarded when the account materialized because the column did not exist.
 *
 * The columns are nullable because tenants created before this migration have no value for them.
 * Registration requires all of them going forward; the nullability is history, not policy.
 */
export class FiscalAddressAndCountry1788021416701 implements MigrationInterface {
  name = 'FiscalAddressAndCountry1788021416701';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "state" character varying`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "postal_code" character varying`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "company_size" character varying`);

    await queryRunner.query(`ALTER TABLE "pending_registrations" ADD COLUMN IF NOT EXISTS "city" character varying`);
    await queryRunner.query(`ALTER TABLE "pending_registrations" ADD COLUMN IF NOT EXISTS "state" character varying`);
    await queryRunner.query(`ALTER TABLE "pending_registrations" ADD COLUMN IF NOT EXISTS "postal_code" character varying`);
    await queryRunner.query(`ALTER TABLE "pending_registrations" ADD COLUMN IF NOT EXISTS "country_code" character varying(2)`);

    // Backfill the country from the fiscal region the tenant was already provisioned under. This
    // is the one place the two sources can be reconciled without guessing: the region is what the
    // tenant's chart of accounts and taxes were actually built from.
    //
    // The cast is required, and it is a finding in itself: `organizations.fiscal_region_id` is a
    // `character varying` with no foreign key, while `fiscal_regions.id` is a uuid — so Postgres
    // rejects the join outright (`operator does not exist: character varying = uuid`) and, more to
    // the point, nothing has ever stopped the column from holding a value that references no row.
    await queryRunner.query(`
      UPDATE "organizations" o
         SET "country" = fr."countryCode"
        FROM "fiscal_regions" fr
       WHERE o."fiscal_region_id"::text = fr."id"::text
         AND o."country" IS NULL
    `);

    // Make the reference real. A tenant whose fiscal region cannot be resolved has no chart of
    // accounts, no taxes and no fiscal identity, so a dangling value in this column is not a data
    // quality nuisance — it is an unusable tenant that the database was happy to store.
    await queryRunner.query(`
      UPDATE "organizations"
         SET "fiscal_region_id" = NULL
       WHERE "fiscal_region_id" IS NOT NULL
         AND "fiscal_region_id" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    `);
    await queryRunner.query(`
      UPDATE "organizations" o
         SET "fiscal_region_id" = NULL
       WHERE o."fiscal_region_id" IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "fiscal_regions" fr WHERE fr."id"::text = o."fiscal_region_id"::text
         )
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ALTER COLUMN "fiscal_region_id" TYPE uuid USING "fiscal_region_id"::uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD CONSTRAINT "FK_organizations_fiscal_region"
        FOREIGN KEY ("fiscal_region_id") REFERENCES "fiscal_regions"("id")
        ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "FK_organizations_fiscal_region"`);
    await queryRunner.query(`ALTER TABLE "organizations" ALTER COLUMN "fiscal_region_id" TYPE character varying USING "fiscal_region_id"::text`);
    await queryRunner.query(`ALTER TABLE "pending_registrations" DROP COLUMN IF EXISTS "country_code"`);
    await queryRunner.query(`ALTER TABLE "pending_registrations" DROP COLUMN IF EXISTS "postal_code"`);
    await queryRunner.query(`ALTER TABLE "pending_registrations" DROP COLUMN IF EXISTS "state"`);
    await queryRunner.query(`ALTER TABLE "pending_registrations" DROP COLUMN IF EXISTS "city"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "company_size"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "postal_code"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "state"`);
    // `country` is not dropped: it existed before this migration and now carries backfilled data.
  }
}
