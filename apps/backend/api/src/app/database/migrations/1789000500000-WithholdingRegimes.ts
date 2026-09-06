import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Withholding stops being a number the client sends.
 *
 * ## What was wrong
 *
 * `taxWithholdingRate` and `incomeTaxWithholdingRate` arrived on the create-invoice request as any
 * fraction between 0 and 1, and the engine checked only that range. Withholding is not a
 * commercial term the parties agree: the rate follows from the payer's fiscal status, the payee's,
 * and what is being sold. Under-withhold and the seller owes the difference with penalties;
 * over-withhold and the buyer has been charged money nobody had the authority to charge. And the
 * document recorded only the resulting amount, so a return reporting a withholding could not say
 * on what authority it had been taken.
 *
 * ## What this adds
 *
 * - `customers.taxpayer_type` — the buyer's fiscal classification, which is the fact that decides
 *   whether they withhold. It is assigned by the tax authority (a withholding agent is one because
 *   it appears on a published list) and cannot be inferred from anything else on the record, so it
 *   is recorded rather than guessed. NULL means unclassified, and nothing is withheld
 *   automatically.
 * - `tenant_withholding_regimes` — the regimes a tenant configures for itself. Most of this
 *   product's markets cannot have a national withholding table: Colombia's ReteICA depends on the
 *   municipality, Peru's detracciones on the good or service, Mexico's on the type of service. For
 *   those the built-in catalogue holds nothing at all, and this table is how a tenant states its
 *   own obligations. It is also how any tenant absorbs a rate change decreed between releases.
 * - `invoices.withholding_regime_codes` and `withholding_override_reason` — which rule produced
 *   the figures, or the stated justification for departing from it.
 *
 * Existing invoices keep an empty regime array: what rate they used is knowable from their
 * amounts, but on whose authority is not, and inventing a citation for a historical document is
 * worse than leaving the field empty.
 */
export class WithholdingRegimes1789000500000 implements MigrationInterface {
  name = 'WithholdingRegimes1789000500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customers"
        ADD COLUMN IF NOT EXISTS "taxpayer_type" varchar(24)
    `);

    // The tenant's own classification, as the seller. A negocio de único dueño is a natural
    // person for withholding purposes and its corporate customers withhold from it at rates that
    // do not apply between companies; assuming a company under-withholds every invoice it issues.
    await queryRunner.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN IF NOT EXISTS "taxpayer_type" varchar(24)
    `);

    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD COLUMN IF NOT EXISTS "withholding_regime_codes" text[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS "withholding_override_reason" text
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenant_withholding_regimes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "code" varchar(40) NOT NULL,
        "label" varchar(160) NOT NULL,
        "kind" varchar(8) NOT NULL,
        "rate" numeric(9,6) NOT NULL,
        "payers" text[] NOT NULL,
        "payees" text[] NOT NULL DEFAULT '{}',
        "scope" varchar(10) NOT NULL DEFAULT 'ANY',
        "legal_basis" text NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_withholding_regimes" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "tenant_withholding_regimes"
        DROP CONSTRAINT IF EXISTS "FK_tenant_withholding_regimes_organization"
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant_withholding_regimes"
        ADD CONSTRAINT "FK_tenant_withholding_regimes_organization"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_withholding_regimes_code"
        ON "tenant_withholding_regimes" ("organization_id", "code")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tenant_withholding_regimes_org"
        ON "tenant_withholding_regimes" ("organization_id", "is_active")
    `);

    // A rate outside [0, 1] is not a withholding rate, and a regime with no payer applies to
    // nobody — both are configuration mistakes that would otherwise surface as a wrong filing.
    await queryRunner.query(`
      ALTER TABLE "tenant_withholding_regimes"
        DROP CONSTRAINT IF EXISTS "CHK_tenant_withholding_regimes_rate"
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant_withholding_regimes"
        ADD CONSTRAINT "CHK_tenant_withholding_regimes_rate"
        CHECK ("rate" >= 0 AND "rate" <= 1 AND array_length("payers", 1) >= 1)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_withholding_regimes"`);
    await queryRunner.query(`
      ALTER TABLE "invoices"
        DROP COLUMN IF EXISTS "withholding_regime_codes",
        DROP COLUMN IF EXISTS "withholding_override_reason"
    `);
    await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "taxpayer_type"`);
    await queryRunner.query(
      `ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "taxpayer_type"`,
    );
  }
}
