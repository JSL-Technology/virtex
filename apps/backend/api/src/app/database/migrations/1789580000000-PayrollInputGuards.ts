import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payroll inputs that cannot raise the net through the back door (audit 2026-11-07, NOM-03,
 * NOM-05), and the warnings an approver must see.
 *
 *  - `payroll_inputs`: amount, hours and rate are never negative. `NOT VALID`: an input already
 *    stored negative stays readable (it is part of a run's history) and the calculation refuses it;
 *    every new or changed row is checked.
 *  - `payroll_runs.calculation_warnings`: what the calculation found unusual. Approving a run with
 *    any takes an explicit acknowledgement.
 */
export class PayrollInputGuards1789580000000 implements MigrationInterface {
  name = 'PayrollInputGuards1789580000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "payroll_inputs"
        ADD CONSTRAINT "CHK_payroll_inputs_not_negative"
          CHECK (COALESCE("amount", 0) >= 0 AND COALESCE("quantity", 0) >= 0 AND COALESCE("rate", 0) >= 0) NOT VALID`);
    await q.query(`ALTER TABLE "payroll_runs" ADD COLUMN "calculation_warnings" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "payroll_runs" DROP COLUMN "calculation_warnings"`);
    await q.query(`ALTER TABLE "payroll_inputs" DROP CONSTRAINT "CHK_payroll_inputs_not_negative"`);
  }
}
