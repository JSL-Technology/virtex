import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payroll hardening: the schema the audit fixes need.
 *
 * 1. Two payslip columns: the employee INFOTEP levy on the regalía, and non-statutory employer costs
 *    (EMPLOYER_CONTRIBUTION concepts) so they can be booked as an expense.
 * 2. The contribution floor multiplier, and the bank-payment entry link on the run.
 * 3. `payroll_inputs` — the per-run variable inputs (overtime, bonuses, loan instalments) — under the
 *    same tenant row-level-security policy as the other payroll tables.
 * 4. A partial unique index guaranteeing at most one non-cancelled REGULAR and one CHRISTMAS_BONUS run
 *    per period, so a concurrent double-create cannot slip past the service check.
 * 5. Sets the AFP/SFS floor to one minimum wage and seeds the 0.5 % employee INFOTEP levy on the
 *    regalía, both versioned.
 */
export class PayrollModuleHardening1789003200000 implements MigrationInterface {
  name = 'PayrollModuleHardening1789003200000';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Payslip columns
    await q.query(`
      ALTER TABLE "payslips"
        ADD COLUMN IF NOT EXISTS "infotep_employee" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "other_employer_contributions" numeric(14,2) NOT NULL DEFAULT 0
    `);

    // 2. Contribution floor + run payment link
    await q.query(`
      ALTER TABLE "payroll_statutory_contributions"
        ADD COLUMN IF NOT EXISTS "floor_min_wage_multiplier" numeric(9,4)
    `);
    await q.query(`
      ALTER TABLE "payroll_runs"
        ADD COLUMN IF NOT EXISTS "payment_journal_entry_id" uuid
    `);

    // 3. payroll_inputs
    await q.query(`
      CREATE TABLE IF NOT EXISTS "payroll_inputs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "employee_id" uuid NOT NULL,
        "concept_code" varchar NOT NULL,
        "amount" numeric(14,2),
        "quantity" numeric(12,4),
        "rate" numeric(9,6),
        "note" varchar,
        CONSTRAINT "PK_payroll_inputs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payroll_input_run" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payroll_input_run_employee_concept"
        ON "payroll_inputs" ("run_id", "employee_id", "concept_code")
    `);

    // RLS on the new tenant table, matching the existing tenant_isolation policy.
    const setting = `NULLIF(current_setting('app.current_organization', true), '')`;
    await q.query(`ALTER TABLE "payroll_inputs" ENABLE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "payroll_inputs"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "payroll_inputs"
        USING ("organization_id" = ${setting}::uuid)
        WITH CHECK ("organization_id" = ${setting}::uuid)
    `);

    // 4. At most one non-cancelled REGULAR / CHRISTMAS_BONUS run per period.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payroll_run_period_type_active"
        ON "payroll_runs" ("organization_id", "period_year", "period_month", "run_type")
        WHERE "status" <> 'CANCELLED' AND "run_type" IN ('REGULAR', 'CHRISTMAS_BONUS')
    `);

    // 5. AFP/SFS floor = 1 minimum wage; seed the employee INFOTEP levy on the regalía (0.5 %).
    await q.query(`
      UPDATE "payroll_statutory_contributions"
        SET "floor_min_wage_multiplier" = 1
        WHERE "country_code" = 'DO' AND "regime" IN ('AFP', 'SFS')
          AND "floor_min_wage_multiplier" IS NULL
    `);
    await q.query(`
      INSERT INTO "payroll_statutory_references" ("country_code","key","effective_from","value","currency_code")
      SELECT 'DO', 'BONUS_EMPLOYEE_LEVY_RATE', '2020-01-01', 0.005, 'DOP'
      WHERE NOT EXISTS (
        SELECT 1 FROM "payroll_statutory_references"
        WHERE "country_code" = 'DO' AND "key" = 'BONUS_EMPLOYEE_LEVY_RATE' AND "effective_from" = '2020-01-01')
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "payroll_inputs"`);
    await q.query(`DROP TABLE IF EXISTS "payroll_inputs"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_payroll_run_period_type_active"`);
    await q.query(
      `DELETE FROM "payroll_statutory_references" WHERE "country_code" = 'DO' AND "key" = 'BONUS_EMPLOYEE_LEVY_RATE'`,
    );
    await q.query(`ALTER TABLE "payroll_runs" DROP COLUMN IF EXISTS "payment_journal_entry_id"`);
    await q.query(
      `ALTER TABLE "payroll_statutory_contributions" DROP COLUMN IF EXISTS "floor_min_wage_multiplier"`,
    );
    await q.query(`
      ALTER TABLE "payslips"
        DROP COLUMN IF EXISTS "infotep_employee",
        DROP COLUMN IF EXISTS "other_employer_contributions"
    `);
  }
}
