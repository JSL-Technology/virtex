import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payroll stops being shaped like the Dominican TSS (audit 2026-11-07, JUR-01; pattern SP-02).
 *
 *  - `payroll_statutory_contributions.regime` was an enum of the four Dominican funds. It becomes
 *    `contribution_code`, free text checked against each country's catalogue in the application.
 *  - `payslips` carried one column per Dominican fund and side (`afp_employee`, `sfs_employer`,
 *    `srl_employer`, `infotep_employee`…). They become one `statutory_contributions` list plus the
 *    two totals the ledger and the lists sum. Existing payslips are rewritten into the list with
 *    exactly the amounts they had, bucketed as the Dominican strategy buckets them, and the totals
 *    are checked against the old columns before those are dropped: a payslip is a legal record.
 *  - `tss_base`, `employee_tss_nss` and `payroll_concepts.contributes_to_tss` are renamed to the
 *    neutral `contributory_base`, `employee_social_security_number` and
 *    `contributes_to_social_security`.
 */
export class PayrollContributionCatalogue1789480000000 implements MigrationInterface {
  name = 'PayrollContributionCatalogue1789480000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "payroll_statutory_contributions" RENAME COLUMN "regime" TO "contribution_code"`);
    await q.query(
      `ALTER TABLE "payroll_statutory_contributions"
         ALTER COLUMN "contribution_code" TYPE character varying(32) USING "contribution_code"::text`,
    );
    await q.query(`DROP TYPE IF EXISTS "public"."payroll_statutory_contributions_regime_enum"`);

    await q.query(`
      ALTER TABLE "payslips"
        ADD COLUMN "statutory_contributions" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN "statutory_employee_contributions" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "statutory_employer_contributions" numeric(14,2) NOT NULL DEFAULT 0`);

    // Every existing payslip is Dominican (no other country has a payroll strategy). Bases and rates
    // were not stored per fund, so the list carries the amounts, which is what was paid and booked.
    await q.query(`
      UPDATE "payslips" p SET
        "statutory_contributions" = COALESCE((
          SELECT jsonb_agg(c.item ORDER BY c.ord)
            FROM (VALUES
              (1, jsonb_build_object('code', 'AFP', 'bucket', 'PENSION', 'appliedBase', p."tss_base", 'employeeRate', 0, 'employerRate', 0,
                                     'employeeAmount', p."afp_employee", 'employerAmount', p."afp_employer")),
              (2, jsonb_build_object('code', 'SFS', 'bucket', 'HEALTH', 'appliedBase', p."tss_base", 'employeeRate', 0, 'employerRate', 0,
                                     'employeeAmount', p."sfs_employee", 'employerAmount', p."sfs_employer")),
              (3, jsonb_build_object('code', 'SRL', 'bucket', 'OTHER', 'appliedBase', p."tss_base", 'employeeRate', 0, 'employerRate', 0,
                                     'employeeAmount', 0, 'employerAmount', p."srl_employer")),
              (4, jsonb_build_object('code', 'INFOTEP', 'bucket', 'OTHER', 'appliedBase', p."tss_base", 'employeeRate', 0, 'employerRate', 0,
                                     'employeeAmount', p."infotep_employee", 'employerAmount', p."infotep_employer"))
            ) AS c(ord, item)
           WHERE (c.item ->> 'employeeAmount')::numeric <> 0 OR (c.item ->> 'employerAmount')::numeric <> 0
        ), '[]'::jsonb),
        "statutory_employee_contributions" = p."afp_employee" + p."sfs_employee" + p."infotep_employee",
        "statutory_employer_contributions" = p."afp_employer" + p."sfs_employer" + p."srl_employer" + p."infotep_employer"`);

    const [mismatch] = await q.query(`
      SELECT count(*)::int AS n FROM "payslips" p
       WHERE p."statutory_employee_contributions" <> COALESCE((
               SELECT sum((c ->> 'employeeAmount')::numeric) FROM jsonb_array_elements(p."statutory_contributions") c), 0)
          OR p."statutory_employer_contributions" <> COALESCE((
               SELECT sum((c ->> 'employerAmount')::numeric) FROM jsonb_array_elements(p."statutory_contributions") c), 0)`);
    if (mismatch.n > 0) {
      throw new Error(`${mismatch.n} payslip(s) would change amounts in the rewrite; migration aborted.`);
    }

    await q.query(`
      ALTER TABLE "payslips"
        DROP COLUMN "afp_employee",
        DROP COLUMN "sfs_employee",
        DROP COLUMN "infotep_employee",
        DROP COLUMN "afp_employer",
        DROP COLUMN "sfs_employer",
        DROP COLUMN "srl_employer",
        DROP COLUMN "infotep_employer"`);
    await q.query(`ALTER TABLE "payslips" RENAME COLUMN "tss_base" TO "contributory_base"`);
    await q.query(`ALTER TABLE "payslips" RENAME COLUMN "employee_tss_nss" TO "employee_social_security_number"`);
    await q.query(`ALTER TABLE "payroll_concepts" RENAME COLUMN "contributes_to_tss" TO "contributes_to_social_security"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "payroll_concepts" RENAME COLUMN "contributes_to_social_security" TO "contributes_to_tss"`);
    await q.query(`ALTER TABLE "payslips" RENAME COLUMN "employee_social_security_number" TO "employee_tss_nss"`);
    await q.query(`ALTER TABLE "payslips" RENAME COLUMN "contributory_base" TO "tss_base"`);
    const side = (code: string, amount: string) =>
      `COALESCE((SELECT sum((c ->> '${amount}')::numeric) FROM jsonb_array_elements("statutory_contributions") c WHERE c ->> 'code' = '${code}'), 0)`;
    await q.query(`
      ALTER TABLE "payslips"
        ADD COLUMN "afp_employee" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "sfs_employee" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "infotep_employee" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "afp_employer" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "sfs_employer" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "srl_employer" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "infotep_employer" numeric(14,2) NOT NULL DEFAULT 0`);
    await q.query(`
      UPDATE "payslips" SET
        "afp_employee" = ${side('AFP', 'employeeAmount')}, "afp_employer" = ${side('AFP', 'employerAmount')},
        "sfs_employee" = ${side('SFS', 'employeeAmount')}, "sfs_employer" = ${side('SFS', 'employerAmount')},
        "srl_employer" = ${side('SRL', 'employerAmount')},
        "infotep_employee" = ${side('INFOTEP', 'employeeAmount')}, "infotep_employer" = ${side('INFOTEP', 'employerAmount')}`);
    await q.query(`
      ALTER TABLE "payslips"
        DROP COLUMN "statutory_contributions",
        DROP COLUMN "statutory_employee_contributions",
        DROP COLUMN "statutory_employer_contributions"`);
    await q.query(`CREATE TYPE "public"."payroll_statutory_contributions_regime_enum" AS ENUM('AFP', 'SFS', 'SRL', 'INFOTEP')`);
    await q.query(
      `ALTER TABLE "payroll_statutory_contributions"
         ALTER COLUMN "contribution_code" TYPE "public"."payroll_statutory_contributions_regime_enum"
         USING "contribution_code"::"public"."payroll_statutory_contributions_regime_enum"`,
    );
    await q.query(`ALTER TABLE "payroll_statutory_contributions" RENAME COLUMN "contribution_code" TO "regime"`);
  }
}
