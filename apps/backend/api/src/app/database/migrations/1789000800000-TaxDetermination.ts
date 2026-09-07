import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sales tax in the markets that have no national rate.
 *
 * ## What was wrong
 *
 * `COUNTRY_TAX_SCHEMES` marks the United States and Brazil `configurationRequired` because their
 * base is sub-national, and `allowedTaxFractions` therefore returned null for them — so the rate
 * came off the request and **nothing checked it**. For a product sold in the United States that is
 * not a missing feature: there was no jurisdiction determination, no destination sourcing, no
 * record of where the tenant has nexus, and no way for the tenant to state any of it. Whatever
 * number reached the API was charged to the buyer and reported on the return.
 *
 * ## What this adds
 *
 * `tax_jurisdictions` holds the jurisdictions **this tenant is registered in**, with their rate
 * and the dates it was in force. Building a rate table for twelve thousand US jurisdictions is not
 * defensible and this does not try to: a business with nexus in three states maintains three to
 * nine rows and gets correct determination, and one that outgrows that connects a provider
 * (Avalara, Vertex, TaxJar) through the `TaxDeterminationProvider` port, after which this table is
 * the fallback rather than the source.
 *
 * `invoices.tax_determination` records how each document's rate was reached — which jurisdictions,
 * at what rate, from which source — because a return is filed per jurisdiction, and because a sale
 * correctly untaxed for want of nexus must be distinguishable from one somebody forgot to tax.
 */
export class TaxDetermination1789000800000 implements MigrationInterface {
  name = 'TaxDetermination1789000800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tax_jurisdictions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "country_code" character varying(2) NOT NULL,
        "state_code" character varying(8) NOT NULL,
        "county" character varying(120),
        "city" character varying(120),
        "postal_code" character varying(16),
        "level" character varying(10) NOT NULL,
        "name" character varying(160) NOT NULL,
        "rate" numeric(9,6) NOT NULL,
        "is_registered" boolean NOT NULL DEFAULT true,
        "sourcing" character varying(12) NOT NULL DEFAULT 'DESTINATION',
        "effective_from" date NOT NULL,
        "effective_to" date,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tax_jurisdictions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "tax_jurisdictions"
        DROP CONSTRAINT IF EXISTS "FK_tax_jurisdictions_organization"
    `);
    await queryRunner.query(`
      ALTER TABLE "tax_jurisdictions"
        ADD CONSTRAINT "FK_tax_jurisdictions_organization"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tax_jurisdictions_lookup"
        ON "tax_jurisdictions" ("organization_id", "country_code", "state_code", "effective_from")
    `);

    // A rate outside [0, 1] is not a rate, and a window that ends before it starts is not a window.
    await queryRunner.query(`
      ALTER TABLE "tax_jurisdictions"
        DROP CONSTRAINT IF EXISTS "CHK_tax_jurisdictions_rate"
    `);
    await queryRunner.query(`
      ALTER TABLE "tax_jurisdictions"
        ADD CONSTRAINT "CHK_tax_jurisdictions_rate"
        CHECK ("rate" >= 0 AND "rate" <= 1
               AND ("effective_to" IS NULL OR "effective_to" >= "effective_from"))
    `);

    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD COLUMN IF NOT EXISTS "tax_determination" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "tax_determination"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tax_jurisdictions"`);
  }
}
