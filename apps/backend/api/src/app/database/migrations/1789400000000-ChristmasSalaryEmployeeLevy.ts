import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * No INFOTEP levy is withheld from the salario de Navidad (audit 2026-10-31, NOM-03).
 *
 * The seed withheld 1 % of the regalía pascual as "INFOTEP empleado" while the payslip said 0.5 %.
 * Neither figure has a footing on the regalía: the employee's 0.5 % of Ley 116-80 is levied on the
 * profit share the company pays (utilidades / bonificación), and the Código de Trabajo shields the
 * salario de Navidad from deductions. Withholding it took the employee's money for a contribution
 * the regalía does not owe.
 *
 * The rate stays a versioned parameter (BONUS_EMPLOYEE_LEVY_RATE), now zero. Runs already
 * calculated keep what they snapshotted. TO VERIFY with a Dominican accountant; if a levy is due,
 * it is a new dated row, not a code change.
 */
export class ChristmasSalaryEmployeeLevy1789400000000 implements MigrationInterface {
  name = 'ChristmasSalaryEmployeeLevy1789400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "payroll_statutory_references" SET "value" = 0, "updated_at" = now()
       WHERE "country_code" = 'DO' AND "key" = 'BONUS_EMPLOYEE_LEVY_RATE'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "payroll_statutory_references" SET "value" = 0.01, "updated_at" = now()
       WHERE "country_code" = 'DO' AND "key" = 'BONUS_EMPLOYEE_LEVY_RATE' AND "effective_from" = '2020-01-01'
    `);
  }
}
