import { Entity, Column, Index, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { Payslip } from './payslip.entity';

/**
 * The lifecycle of a run. It only moves forward.
 *
 * DRAFT is the only editable state. CALCULATED has payslips and totals but has posted nothing.
 * APPROVED has posted the accounting entry and is immutable. PAID has settled through treasury.
 * CANCELLED is a DRAFT/CALCULATED abandoned before it posted. There is no "edit an APPROVED run":
 * a mistake found after approval is fixed by an adjustment run (`correctsRunId`), never by rewriting
 * history — the same rule the ledger enforces on a posted entry.
 */
export enum PayrollRunStatus {
  DRAFT = 'DRAFT',
  CALCULATED = 'CALCULATED',
  APPROVED = 'APPROVED',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

/** The kind of run. An adjustment corrects an already-approved run for the same period. */
export enum PayrollRunType {
  REGULAR = 'REGULAR',
  /** A 13th-month (regalía pascual) run. */
  CHRISTMAS_BONUS = 'CHRISTMAS_BONUS',
  /** A complementary/adjustment run that corrects a prior approved run. */
  ADJUSTMENT = 'ADJUSTMENT',
}

/**
 * A payroll run for one period — the immutable document the module produces.
 *
 * ## Immutability and the parameter snapshot
 *
 * Two invariants meet here. First, a processed run does not change: once APPROVED it has posted to
 * the ledger and fed a TSS filing, so it is corrected by an adjustment run, not by an UPDATE.
 * Second, it must reproduce forever: `parameterSnapshot` freezes the exact AFP/SFS/SRL/INFOTEP rates,
 * caps, minimum wage and ISR scale used, so reprinting a two-year-old payslip yields the same
 * numbers even after the law changed and even if a parameter row were later corrected. The run
 * reads the versioned parameters once, at calculation, and then trusts its own snapshot.
 *
 * `journalEntryId` links the posted accounting entry; the posting is idempotent on `payroll:{id}`.
 */
@Entity('payroll_runs')
@Index('IDX_payroll_run_org_period', ['organizationId', 'periodYear', 'periodMonth', 'runType'])
export class PayrollRun extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  override organizationId: string = undefined!; // NOT NULL override; hydrated by TypeORM

  @Column({ name: 'name' })
  name: string;

  @Column({ name: 'country_code', length: 2, default: 'DO' })
  countryCode: string;

  @Column({ name: 'period_year', type: 'int' })
  periodYear: number;

  @Column({ name: 'period_month', type: 'int' })
  periodMonth: number;

  /** First and last day the run covers, so a mid-month hire/termination can be prorated exactly. */
  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @Column({ name: 'pay_date', type: 'date' })
  payDate: string;

  @Column({ name: 'run_type', type: 'enum', enum: PayrollRunType, default: PayrollRunType.REGULAR })
  runType: PayrollRunType;

  @Column({ name: 'status', type: 'enum', enum: PayrollRunStatus, default: PayrollRunStatus.DRAFT })
  status: PayrollRunStatus;

  /** Frozen copy of the statutory parameters used, so the run reproduces regardless of later change. */
  @Column({ name: 'parameter_snapshot', type: 'jsonb', nullable: true })
  parameterSnapshot: unknown | null;

  // ── Totals, in the run currency (cents precision) ────────────────────────────

  @Column({ name: 'total_gross', type: 'numeric', precision: 16, scale: 2, default: 0, transformer: numericTransformerNotNull })
  totalGross: number;

  @Column({ name: 'total_employee_deductions', type: 'numeric', precision: 16, scale: 2, default: 0, transformer: numericTransformerNotNull })
  totalEmployeeDeductions: number;

  @Column({ name: 'total_net', type: 'numeric', precision: 16, scale: 2, default: 0, transformer: numericTransformerNotNull })
  totalNet: number;

  @Column({ name: 'total_employer_contributions', type: 'numeric', precision: 16, scale: 2, default: 0, transformer: numericTransformerNotNull })
  totalEmployerContributions: number;

  @Column({ name: 'currency_code', length: 3, default: 'DOP' })
  currencyCode: string;

  // ── Links and audit of the lifecycle ─────────────────────────────────────────

  /** The run this one corrects, when `runType` is ADJUSTMENT. */
  @Column({ name: 'corrects_run_id', type: 'uuid', nullable: true })
  correctsRunId: string | null;

  @ManyToOne(() => PayrollRun, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'corrects_run_id' })
  correctsRun: PayrollRun | null;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ name: 'calculated_by', type: 'uuid', nullable: true })
  calculatedBy: string | null;

  @Column({ name: 'calculated_at', type: 'timestamptz', nullable: true })
  calculatedAt: Date | null;

  /** Who approved it — never the same person who calculated it (segregation of duties). */
  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @OneToMany(() => Payslip, (p) => p.run)
  payslips: Payslip[];
}
