import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove the third competing source of country configuration.
 *
 * `libs/api/country` published `GET /countries/:code` from a hardcoded array of three countries,
 * with tax-id rules expressed as regexes (`^[0-9]{9,11}$` for the Dominican RNC — which accepts
 * every nine-digit string, including the 90% that carry a wrong check digit). Alongside it sat six
 * `FiscalRegion` rows and a hardcoded list of eight in the signup form. Three lists, three answers
 * to the same question, and the one the signup form actually read was the least correct.
 *
 * `COUNTRY_FISCAL_PROFILES` is now the single authority and `fiscal_regions` its projection, so
 * the table backing the removed module has no owner. It is dropped rather than left behind: an
 * unowned table with plausible-looking contents is how the next person reintroduces the drift.
 *
 * `down` recreates the table but not its contents. The data it held is superseded by
 * `fiscal_regions`, which the boot seed repopulates from the profiles on every start.
 */
export class DropDuplicateCountryConfigs1788023000000 implements MigrationInterface {
  name = 'DropDuplicateCountryConfigs1788023000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "country_configs"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "country_configs" (
        "code" character varying(2) NOT NULL,
        "name" character varying NOT NULL,
        "currencyCode" character varying NOT NULL,
        "currencySymbol" character varying NOT NULL,
        "locale" character varying NOT NULL,
        "phoneCode" character varying NOT NULL,
        "formSchema" jsonb NOT NULL,
        CONSTRAINT "PK_e04619e4624e1ed891e0f8fdec2" PRIMARY KEY ("code")
      )
    `);
  }
}
