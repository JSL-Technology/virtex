import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Budget control becomes configurable per company (FINB-20).
 *
 * A posting past its budget line was always refused, with nothing to configure: no warning mode,
 * no tolerance. `budget_control_mode` says what happens — `block` (the old behaviour, and the
 * default, so no company's control loosens without someone deciding it), `warn` or `none` — and
 * `budget_tolerance_bps` how far past its line a posting may go first. Both are bounded by the
 * database, like the purchasing tolerances beside them.
 */
export class BudgetControlMode1789730000000 implements MigrationInterface {
  name = 'BudgetControlMode1789730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organization_settings" ADD "budget_control_mode" character varying(5) NOT NULL DEFAULT 'block'`,
    );
    await queryRunner.query(`ALTER TABLE "organization_settings" ADD "budget_tolerance_bps" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(
      `ALTER TABLE "organization_settings" ADD CONSTRAINT "CHK_organization_settings_budget_control_mode" CHECK ("budget_control_mode" IN ('block', 'warn', 'none'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "organization_settings" ADD CONSTRAINT "CHK_organization_settings_budget_tolerance" CHECK ("budget_tolerance_bps" BETWEEN 0 AND 5000)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organization_settings" DROP CONSTRAINT "CHK_organization_settings_budget_tolerance"`);
    await queryRunner.query(`ALTER TABLE "organization_settings" DROP CONSTRAINT "CHK_organization_settings_budget_control_mode"`);
    await queryRunner.query(`ALTER TABLE "organization_settings" DROP COLUMN "budget_tolerance_bps"`);
    await queryRunner.query(`ALTER TABLE "organization_settings" DROP COLUMN "budget_control_mode"`);
  }
}
