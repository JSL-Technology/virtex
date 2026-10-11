import { MigrationInterface, QueryRunner } from 'typeorm';
import es from '../../i18n/messages/es.json';
import en from '../../i18n/messages/en.json';
import pt from '../../i18n/messages/pt.json';
import {
  SeedLanguage,
  UNITS_OF_MEASURE,
  seedTenantDefaults,
  seedUnitsOfMeasure,
} from '../seeds/tenant-defaults';

/** The generated API catalogues, read directly: migrations run without the application's DI. */
const CATALOGUES: Record<SeedLanguage, Record<string, string>> = { es, en, pt };
const translate = (key: string, language: SeedLanguage): string =>
  CATALOGUES[language][key] ?? CATALOGUES.es[key] ?? key;

/**
 * The working data every company starts with — and the backfill for those created before it.
 *
 * - `customers.is_final_consumer`, one per tenant: the «Consumidor final» a sale names when it
 *   names nobody.
 * - The unit-of-measure catalogue. It was empty: its seeder was never registered, so the product
 *   form had nothing to offer and every product carried the column default.
 * - For every existing tenant, the same seed provisioning now runs (`seedTenantDefaults`): the
 *   final consumer, a default product category, a cash account on the chart's cash account, and the
 *   Dominican payroll concepts. Idempotent, so a tenant that already has any of them keeps its own.
 *
 * Runs per tenant with `app.current_organization` set, so it reads and writes through row-level
 * security exactly as the application does.
 */
export class TenantWorkingDefaults1789009800000 implements MigrationInterface {
  name = 'TenantWorkingDefaults1789009800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "is_final_consumer" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customers_org_final_consumer"
         ON "customers" ("organization_id") WHERE "is_final_consumer"`,
    );

    await seedUnitsOfMeasure(queryRunner);

    const tenants: Array<{
      id: string;
      country: string | null;
      books_language: string | null;
      base_currency: string | null;
      default_cash_id: string | null;
    }> = await queryRunner.query(
      `SELECT o."id", o."country", o."books_language",
              s."base_currency", s."default_cash_id"
         FROM "organizations" o
         LEFT JOIN "organization_settings" s ON s."organization_id" = o."id"`,
    );

    for (const tenant of tenants) {
      await queryRunner.query(`SELECT set_config('app.current_organization', $1, true)`, [tenant.id]);
      await seedTenantDefaults(
        queryRunner,
        {
          organizationId: tenant.id,
          country: tenant.country,
          booksLanguage: tenant.books_language,
          baseCurrency: tenant.base_currency ?? 'USD',
          cashAccountId: tenant.default_cash_id,
        },
        translate,
      );
    }
    await queryRunner.query(`SELECT set_config('app.current_organization', '', true)`);
  }

  /**
   * The schema goes back exactly. The seeded rows stay: a final consumer, a category or a till may
   * already carry documents, and deleting working data to undo a migration loses more than it
   * restores. The final consumer simply becomes an ordinary customer. Units of measure nothing
   * references are removed.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_customers_org_final_consumer"`);
    await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "is_final_consumer"`);
    await queryRunner.query(
      `DELETE FROM "unit_of_measure" u
        WHERE u."symbol" = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM "bill_of_material_items" b WHERE b."unit_of_measure_id" = u."id")`,
      [UNITS_OF_MEASURE.map((unit) => unit.symbol)],
    );
  }
}
