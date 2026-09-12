import { Entity, Column, Index, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { PayrollRun } from './payroll-run.entity';
import { PayslipLine } from './payslip-line.entity';

/**
 * One employee's result for one run — the volante de pago.
 *
 * ## The split is stored, not derived
 *
 * AFP and SFS each have an employee share (withheld) and an employer share (an added cost). The
 * audit's non-negotiable is that both are recorded separately, never as a combined number, because
 * the TSS declares them separately, the ledger books them to different accounts, and "how much did
 * the company pay in social security" and "how much was taken from the employee" are different
 * questions a combined figure cannot answer. So every share has its own column here.
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
  @Column({ name: 'organization_id', type: 'uuid' })
  override organizationId: string = undefined!; // NOT NULL override; hydrated by TypeORM

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @ManyToOne(() => PayrollRun, (r) => r.payslips, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: PayrollRun;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  // ── Identity snapshot ────────────────────────────────────────────────────────

  @Column({ name: 'employee_name' })
  employeeName: string;

  /** Masked id (e.g. `***-*******-1`), safe to render. The full cédula stays encrypted on Employee. */
  @Column({ name: 'employee_identity_masked', type: 'varchar', nullable: true })
  employeeIdentityMasked: string | null;

  @Column({ name: 'employee_tss_nss', type: 'varchar', nullable: true })
  employeeTssNss: string | null;

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

  /** The base AFP/SFS were applied to (gross of contributory concepts, capped where the law caps). */
  @Column({ name: 'tss_base', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  tssBase: number;

  /** The base ISR was applied to (taxable earnings net of the employee's AFP+SFS). */
  @Column({ name: 'taxable_base', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  taxableBase: number;

  // Statutory — employee side (withheld)
  @Column({ name: 'afp_employee', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  afpEmployee: number;

  @Column({ name: 'sfs_employee', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  sfsEmployee: number;

  @Column({ name: 'income_tax', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  incomeTax: number;

  // Statutory — employer side (added cost)
  @Column({ name: 'afp_employer', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  afpEmployer: number;

  @Column({ name: 'sfs_employer', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  sfsEmployer: number;

  @Column({ name: 'srl_employer', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  srlEmployer: number;

  @Column({ name: 'infotep_employer', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  infotepEmployer: number;

  // Totals
  @Column({ name: 'other_deductions', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  otherDeductions: number;

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
}
