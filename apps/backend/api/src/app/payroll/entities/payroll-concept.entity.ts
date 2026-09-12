import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformer } from '../../common/database/numeric.transformer';

/** Which side of the payslip a concept lands on. */
export enum ConceptType {
  /** Adds to gross pay (base salary, overtime, commission, bonus). */
  EARNING = 'EARNING',
  /** Withheld from the employee (loan repayment, advance, voluntary savings). */
  DEDUCTION = 'DEDUCTION',
  /** Borne by the employer, not withheld from the employee (statutory employer shares, benefits). */
  EMPLOYER_CONTRIBUTION = 'EMPLOYER_CONTRIBUTION',
}

/** How a concept's amount is arrived at. */
export enum ConceptCalculation {
  /** A fixed amount entered on the run input. */
  FIXED = 'FIXED',
  /** A percentage of the concept's base. */
  PERCENTAGE = 'PERCENTAGE',
  /**
   * Computed by the jurisdiction engine, not by this row (AFP/SFS/ISR). The row exists so the
   * concept has a stable code, a name, and an account to post to; the number comes from the strategy.
   */
  STATUTORY = 'STATUTORY',
}

/**
 * A configurable line a payroll run can produce — an earning, a deduction, or an employer cost.
 *
 * ## Why concepts are rows, not code
 *
 * "Add a transport allowance", "start deducting a cooperative saving", "this bonus is taxable but
 * that one is not" are configuration, not deployments. Each concept declares its type, how it is
 * computed, whether it is taxable for ISR, whether it forms part of the TSS contributory base, and
 * the ledger account it posts to. The calculation engine consumes them; adding one never touches
 * the engine. Statutory concepts (AFP/SFS/ISR) are seeded as system rows so the payslip can carry
 * them as named lines while their amounts come from the versioned parameters.
 */
@Entity('payroll_concepts')
@Index('IDX_payroll_concept_org_code', ['organizationId', 'code'], { unique: true })
export class PayrollConcept extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  override organizationId: string = undefined!; // NOT NULL override; hydrated by TypeORM

  /** Stable code the run input and reports refer to (e.g. `BASE`, `OT`, `AFP`, `ISR`, `LOAN`). */
  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ name: 'type', type: 'enum', enum: ConceptType })
  type: ConceptType;

  @Column({
    name: 'calculation',
    type: 'enum',
    enum: ConceptCalculation,
    default: ConceptCalculation.FIXED,
  })
  calculation: ConceptCalculation;

  /** For PERCENTAGE concepts, the rate (0.03 = 3 %). Null otherwise. */
  @Column({
    name: 'rate',
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  rate: number | null;

  /** Whether this earning is part of the ISR taxable base. Regalía, for instance, is not. */
  @Column({ name: 'taxable', type: 'boolean', default: true })
  taxable: boolean;

  /** Whether this earning forms part of the TSS contributory (SFS/AFP) base. */
  @Column({ name: 'contributes_to_tss', type: 'boolean', default: true })
  contributesToTss: boolean;

  /** The account this concept posts to. Falls back to the settings default for its kind when null. */
  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 100 })
  sortOrder: number;

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;

  /** Seeded concept that the product relies on (AFP/SFS/ISR/BASE). Cannot be deleted by a tenant. */
  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean;
}
