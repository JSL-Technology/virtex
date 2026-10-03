import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The database half of the record-lifecycle audit (docs/CICLO_DE_VIDA_DE_REGISTROS.md).
 *
 * 1. **Payroll names its employees by constraint.** `payslips.employee_id` and
 *    `payroll_inputs.employee_id` pointed at employees with nothing enforcing it: a payslip — a
 *    legal record the social-security and income-tax filings are built from — could outlive the
 *    person it pays. Employees are terminated and soft-deleted, never physically removed while
 *    payroll names them; a physical delete is now refused at commit (DEFERRED, so the tenant's own
 *    deletion still cascades).
 *
 * 2. **A vendor debit note has a lifecycle.** It posted an entry and reduced the bill's balance,
 *    and then could be edited or deleted with neither following. It now records the entry it
 *    posted, and is corrected only by voiding it — reversal entry, reason, time and author on the
 *    note. Notes already issued are `POSTED`; which entry is theirs was never recorded, so voiding
 *    one asks for a manual reversal instead of guessing.
 */
export class RecordLifecycleGuards1789008200000 implements MigrationInterface {
  name = 'RecordLifecycleGuards1789008200000';

  public async up(q: QueryRunner): Promise<void> {
    for (const [table, constraint] of [
      ['payslips', 'FK_payslips_employee'],
      ['payroll_inputs', 'FK_payroll_inputs_employee'],
    ]) {
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`);
      await q.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "${constraint}"
          FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
          ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED
          NOT VALID
      `);
      await q.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM "${table}" t
             WHERE NOT EXISTS (SELECT 1 FROM "employees" e WHERE e."id" = t."employee_id")
          ) THEN
            RAISE NOTICE '${table}: rows name employees that no longer exist; "${constraint}" left NOT VALID until they are reviewed.';
          ELSE
            ALTER TABLE "${table}" VALIDATE CONSTRAINT "${constraint}";
          END IF;
        END $$;
      `);
    }

    await q.query(`
      ALTER TABLE "vendor_debit_note"
        ADD COLUMN IF NOT EXISTS "status" character varying(16) NOT NULL DEFAULT 'POSTED',
        ADD COLUMN IF NOT EXISTS "journal_entry_id" uuid,
        ADD COLUMN IF NOT EXISTS "reversal_journal_entry_id" uuid,
        ADD COLUMN IF NOT EXISTS "void_reason" text,
        ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "voided_by_user_id" uuid
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "vendor_debit_note"
        DROP COLUMN IF EXISTS "voided_by_user_id",
        DROP COLUMN IF EXISTS "voided_at",
        DROP COLUMN IF EXISTS "void_reason",
        DROP COLUMN IF EXISTS "reversal_journal_entry_id",
        DROP COLUMN IF EXISTS "journal_entry_id",
        DROP COLUMN IF EXISTS "status"
    `);
    await q.query(`ALTER TABLE "payroll_inputs" DROP CONSTRAINT IF EXISTS "FK_payroll_inputs_employee"`);
    await q.query(`ALTER TABLE "payslips" DROP CONSTRAINT IF EXISTS "FK_payslips_employee"`);
  }
}
