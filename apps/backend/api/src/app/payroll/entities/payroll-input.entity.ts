import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformer } from '../../common/database/numeric.transformer';

/**
 * A variable input for one employee on one run — the "novedades de nómina" of the period.
 *
 * ## Why this exists
 *
 * Base salary is versioned on {@link EmployeeCompensation} and read automatically, but a payroll is
 * more than the base: the overtime hours worked this month, a one-off bonus, this month's loan
 * instalment. Those are facts about the *period*, not standing configuration, so they are captured
 * per run against a {@link PayrollConcept} by its code. The calculation reads them, resolves each
 * against its concept (which decides taxable/TSS treatment and how the amount is formed), and never
 * trusts a client-computed total — the input carries hours or a principal, the engine does the money.
 *
 * A row is unique per (run, employee, concept): one overtime figure, one loan instalment, per period.
 * Editable only while the run is DRAFT/CALCULATED; an approved run is immutable, so its inputs are too.
 */
@Entity('payroll_inputs')
@Index('IDX_payroll_input_run_employee_concept', ['runId', 'employeeId', 'conceptCode'], {
  unique: true,
})
export class PayrollInput extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  override organizationId: string = undefined!; // NOT NULL override; hydrated by TypeORM

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  /** The concept this input feeds, by its stable code (e.g. `HE35`, `BONO`, `LOAN`). */
  @Column({ name: 'concept_code' })
  conceptCode: string;

  /** For FIXED concepts — the amount. */
  @Column({ name: 'amount', type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numericTransformer })
  amount: number | null;

  /** For HOURLY concepts — the number of hours. */
  @Column({ name: 'quantity', type: 'numeric', precision: 12, scale: 4, nullable: true, transformer: numericTransformer })
  quantity: number | null;

  /** Overrides the concept's own rate/premium when set (PERCENTAGE fraction or HOURLY multiplier). */
  @Column({ name: 'rate', type: 'numeric', precision: 9, scale: 6, nullable: true, transformer: numericTransformer })
  rate: number | null;

  @Column({ name: 'note', type: 'varchar', nullable: true })
  note: string | null;
}
