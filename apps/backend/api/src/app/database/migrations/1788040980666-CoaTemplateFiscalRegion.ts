import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Give `coa_templates` the column its relation always claimed to have.
 *
 * `FiscalRegion.coaTemplates` was declared as `@OneToMany(() => CoaTemplate, template =>
 * template.fiscalRegion)` — naming an inverse property that `CoaTemplate` never declared, and a
 * column that did not exist. TypeORM tolerated it because nothing ever traversed the relation, so
 * a chart-of-accounts template could not actually be associated with a fiscal region: the link the
 * model advertised had no storage behind it.
 *
 * Nullable, because the templates that exist today have no region and there is no correct value to
 * invent for them.
 */
export class CoaTemplateFiscalRegion1788040980666 implements MigrationInterface {
  name = 'CoaTemplateFiscalRegion1788040980666';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "coa_templates" ADD COLUMN IF NOT EXISTS "fiscal_region_id" uuid`);
    await queryRunner.query(`
      ALTER TABLE "coa_templates"
        ADD CONSTRAINT "FK_coa_templates_fiscal_region"
        FOREIGN KEY ("fiscal_region_id") REFERENCES "fiscal_regions"("id")
        ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "coa_templates" DROP CONSTRAINT IF EXISTS "FK_coa_templates_fiscal_region"`);
    await queryRunner.query(`ALTER TABLE "coa_templates" DROP COLUMN IF EXISTS "fiscal_region_id"`);
  }
}
