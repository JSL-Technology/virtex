import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `payroll_runs.country_code` loses its `DEFAULT 'DO'`.
 *
 * The column was created `NOT NULL DEFAULT 'DO'`, so a run inserted without an explicit country
 * became Dominican — and was then computed under Dominican AFP/SFS/ISR rules for whoever the tenant
 * was (A-08). `PayrollRunService` already sets the country from the run's input or the tenant, so
 * the default only ever fired as a wrong answer. The column stays `NOT NULL`: a run with no country
 * must be rejected, not defaulted.
 */
export class DropPayrollRunCountryDefault1789005600000 implements MigrationInterface {
  name = 'DropPayrollRunCountryDefault1789005600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payroll_runs" ALTER COLUMN "country_code" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payroll_runs" ALTER COLUMN "country_code" SET DEFAULT 'DO'`,
    );
  }
}
