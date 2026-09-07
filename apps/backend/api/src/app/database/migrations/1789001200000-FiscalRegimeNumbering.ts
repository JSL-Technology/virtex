import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The two tables that let a tenant outside the Dominican Republic actually issue a fiscal document.
 *
 * `fiscal_document_ranges` is the authorised range a number is drawn from — the equivalent of
 * `ncf_sequences` for the six other regimes, which could not be widened to hold a series prefix, an
 * establishment and emission point, a resolution number or a secret without becoming a table named
 * after one country and shaped like seven.
 *
 * `fiscal_regime_settings` is the per-tenant operational configuration the builders need and the
 * signup form cannot ask for, because it comes from administrative acts that happen after
 * registration.
 *
 * Both carry `ON DELETE CASCADE` to `organizations`: a deleted tenant's authorised ranges are not
 * data anybody may draw from afterwards.
 */
export class FiscalRegimeNumbering1789001200000 implements MigrationInterface {
  name = 'FiscalRegimeNumbering1789001200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fiscal_document_ranges" (
        "id"                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "organization_id"   uuid NOT NULL,
        "country_code"      character varying(2) NOT NULL,
        "document_type"     character varying(8) NOT NULL,
        "series"            character varying(16) NOT NULL DEFAULT '',
        "starts_at"         bigint NOT NULL,
        "ends_at"           bigint NOT NULL,
        "current_sequence"  bigint NOT NULL,
        "is_active"         boolean NOT NULL DEFAULT true,
        "valid_until"       date,
        "authorization_code" character varying(128),
        "secret_kind"       character varying(24),
        "encrypted_secret"  text,
        CONSTRAINT "FK_fiscal_document_ranges_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_fiscal_document_ranges_bounds" CHECK ("ends_at" >= "starts_at"),
        CONSTRAINT "CK_fiscal_document_ranges_cursor"
          CHECK ("current_sequence" >= "starts_at" - 1 AND "current_sequence" <= "ends_at")
      )
    `);

    // One active range per (tenant, market, type, series). Two would let the same number be handed
    // out twice: the draw picks one non-deterministically and each row advances its own counter.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fiscal_document_ranges_active"
        ON "fiscal_document_ranges" ("organization_id", "country_code", "document_type", "series")
        WHERE "is_active" = true
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fiscal_document_ranges_org_country"
        ON "fiscal_document_ranges" ("organization_id", "country_code")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fiscal_regime_settings" (
        "id"                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "organization_id"   uuid NOT NULL,
        "country_code"      character varying(2) NOT NULL,
        "environment"       character varying(16) NOT NULL DEFAULT 'CERTIFICATION',
        "establishment"     character varying(8),
        "emission_point"    character varying(8),
        "numeric_code"      character varying(16),
        "state_code"        character varying(8),
        "municipality_code" character varying(16),
        "resolution_number" character varying(64),
        "activity_code"     character varying(16),
        "origin_comuna"     character varying(64),
        "origin_city"       character varying(64),
        CONSTRAINT "FK_fiscal_regime_settings_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fiscal_regime_settings_org_country"
        ON "fiscal_regime_settings" ("organization_id", "country_code")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "fiscal_regime_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fiscal_document_ranges"`);
  }
}
