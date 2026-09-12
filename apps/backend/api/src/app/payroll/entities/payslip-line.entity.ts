import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';

/** What a line represents on the payslip and how it moves the totals. */
export enum PayslipLineKind {
  EARNING = 'EARNING',
  EMPLOYEE_DEDUCTION = 'EMPLOYEE_DEDUCTION',
  EMPLOYER_CONTRIBUTION = 'EMPLOYER_CONTRIBUTION',
  /** Shown for transparency but not summed into net (e.g. the taxable base, the TSS base). */
  INFORMATIONAL = 'INFORMATIONAL',
}

/**
 * A single detail line of a payslip — the itemisation behind the totals.
 *
 * Each line names its concept, its kind, the base and rate it was computed from, and the amount.
 * `employerPortion` is carried for statutory lines whose employer share is booked as a cost while
 * only the `employeePortion` is withheld — so the split is visible line by line, not only in the
 * payslip's summary columns.
 */
@Entity('payslip_lines')
@Index('IDX_payslip_line_payslip', ['payslipId'])
export class PayslipLine extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  override organizationId: string = undefined!; // NOT NULL override; hydrated by TypeORM

  @Column({ name: 'payslip_id', type: 'uuid' })
  payslipId: string;

  @ManyToOne('Payslip', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payslip_id' })
  payslip: unknown;

  @Column({ name: 'concept_code' })
  conceptCode: string;

  @Column({ name: 'concept_name' })
  conceptName: string;

  @Column({ name: 'kind', type: 'enum', enum: PayslipLineKind })
  kind: PayslipLineKind;

  /** The amount that moves the total for `kind` (the employee's share, for a statutory deduction). */
  @Column({ name: 'amount', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformerNotNull })
  amount: number;

  /** Employer share, for statutory lines. Null for ordinary earnings/deductions. */
  @Column({ name: 'employer_portion', type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numericTransformer })
  employerPortion: number | null;

  @Column({ name: 'base', type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numericTransformer })
  base: number | null;

  @Column({ name: 'rate', type: 'numeric', precision: 9, scale: 6, nullable: true, transformer: numericTransformer })
  rate: number | null;

  @Column({ name: 'sort_order', type: 'int', default: 100 })
  sortOrder: number;
}
