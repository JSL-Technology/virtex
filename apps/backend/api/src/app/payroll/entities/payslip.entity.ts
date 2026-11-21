import { Entity, Column, Index, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { PayrollRun } from './payroll-run.entity';
import { PayslipLine } from './payslip-line.entity';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

/** One statutory contribution on a payslip, as the jurisdiction strategy computed it. */
export interface PayslipContribution {
  code: string;
  bucket: 'PENSION' | 'HEALTH' | 'OTHER';
  appliedBase: number;
  employeeRate: number;
  employerRate: number;
  employeeAmount: number;
  employerAmount: number;
}

/**
 * One employee's result for one run — the volante de pago.
 *
 * ## The split is stored, not derived
 *
 * Each statutory contribution (AFP and SFS in DO, IMSS in MX…) has an employee share (withheld)
 * and an employer share (an added cost). The audit's non-negotiable is that both are recorded
 * separately, never as a combined number, because the authority declares them separately, the
 * ledger books them to different accounts, and "how much did the company pay in social security"
 * and "how much was taken from the employee" are different questions a combined figure cannot
 * answer. So every share is kept, per contribution, in `statutoryContributions`.
 *
 * ## Identity is snapshotted
 *
 * The employee's name and (masked) id are copied onto the payslip at calculation. A payslip is a
 * historical document; if the employee is later renamed, or their record soft-deleted, the payslip
 * must still read the way it did when it was issued.
 *
 * `workedDays`/`baseDays` capture the proration: an employee hired or terminated mid-period earns
 * and contributes on the days actually worked, not a whole month and not zero.
 */
@Entity('payslips')
@Index('IDX_payslip_run_employee', ['runId', 'employeeId'], { unique: true })
export class Payslip extends BaseEntity {
  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @ManyToOne(() => PayrollRun, (r) => r.payslips, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id', foreignKeyConstraintName: 'FK_payslip_run' })
  run: PayrollRun;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  /**
   * The employee, as a constraint (QA lifecycle audit). Payroll history is a legal record: employees
   * are terminated and soft-deleted, never physically removed while a payslip names them. Checked
   * at commit, so deleting the whole tenant still cascades.
   */
  @ManyToOne('Employee', { onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'employee_id', foreignKeyConstraintName: 'FK_payslips_employee' })
  employee?: unknown;

  // ── Identity snapshot ────────────────────────────────────────────────────────

  @Column({ name: 'employee_name' })
  employeeName: string;

  /** Masked id (e.g. `***-*******-1`), safe to render. The full cédula stays encrypted on Employee. */
  @Column({ name: 'employee_identity_masked', type: 'varchar', nullable: true })
  employeeIdentityMasked: string | null;

  @Column({ name: 'employee_social_security_number', type: 'varchar', nullable: true })
  employeeSocialSecurityNumber: string | null;

  // ── Proration ────────────────────────────────────────────────────────────────

  @Column({ name: 'base_days', type: 'int', default: 30 })
  baseDays: number;

  @Column({ name: 'worked_days', type: 'int', default: 30 })
  workedDays: number;

  // ── Amounts (run currency, cents precision) ──────────────────────────────────

  @Column({ name: 'base_salary', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  baseSalary: number;

  @Column({ name: 'gross_earnings', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  grossEarnings: number;

  /** The contributory base: earnings of concepts that contribute to social security, before caps. */
  @Column({ name: 'contributory_base', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  contributoryBase: number;

  /** The base income tax was applied to (taxable earnings net of the pre-tax employee contributions). */
  @Column({ name: 'taxable_base', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  taxableBase: number;

  // Statutory — every contribution the country's law levies, by its catalogue code (audit
  // 2026-11-07, JUR-01). These were eight columns named after the Dominican funds (afp_employee,
  // sfs_employer, srl_employer, infotep_employee…), so a second country's payroll had nowhere to
  // go. The list is the record; the two totals beside it are what the ledger and the lists sum.
  @Column({ name: 'statutory_contributions', type: 'jsonb', default: [] })
  statutoryContributions: PayslipContribution[];

  @Column({ name: 'statutory_employee_contributions', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  statutoryEmployeeContributions: number;

  @Column({ name: 'statutory_employer_contributions', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  statutoryEmployerContributions: number;

  @Column({ name: 'income_tax', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  incomeTax: number;

  // Totals
  @Column({ name: 'other_deductions', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  otherDeductions: number;

  /** Non-statutory employer costs (EMPLOYER_CONTRIBUTION concepts), booked as an expense. */
  @Column({ name: 'other_employer_contributions', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  otherEmployerContributions: number;

  @Column({ name: 'total_employee_deductions', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  totalEmployeeDeductions: number;

  @Column({ name: 'total_employer_contributions', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  totalEmployerContributions: number;

  @Column({ name: 'net_pay', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  netPay: number;

  @Column({ name: 'currency_code', length: 3, default: 'DOP' })
  currencyCode: string;

  @OneToMany(() => PayslipLine, (l) => l.payslip)
  lines: PayslipLine[];

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_payslips_organization')
  organization?: TenantRef;
}
