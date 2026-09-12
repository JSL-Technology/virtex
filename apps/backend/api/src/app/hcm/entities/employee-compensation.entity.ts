import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { Employee } from './employee.entity';

/** How often the base salary is paid. The statutory bases are monthly, so others are normalised. */
export enum PayFrequency {
  MONTHLY = 'MONTHLY',
  BIWEEKLY = 'BIWEEKLY',
  WEEKLY = 'WEEKLY',
}

/**
 * A salary, effective from a date — one row per change, never an overwrite.
 *
 * ## Why a history and not a column
 *
 * A single `salary` column on the employee answers "what do they earn now" and destroys "what did
 * they earn in March". Payroll needs the second: a run for a past period, a recomputation, an
 * audit of a filing already sent, all have to see the salary that was in force *then*, not the one
 * a raise set last week. So a raise inserts a new row with a later `effectiveFrom`; the run for a
 * period reads the row in force on the period, exactly as the ledger reads the tax rate in force on
 * a posting date.
 *
 * The amount is stored in the compensation currency at cents precision (via the numeric
 * transformer), never as a float.
 */
@Entity('employee_compensations')
@Index('IDX_employee_comp_employee_effective', ['employeeId', 'effectiveFrom'], { unique: true })
export class EmployeeCompensation extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  override organizationId: string = undefined!; // NOT NULL override; hydrated by TypeORM

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, (e) => e.compensations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  /** The first day this salary applies. The run reads the latest row at or before the period. */
  @Column({ name: 'effective_from', type: 'date' })
  effectiveFrom: string;

  /** Contractual base salary for one `payFrequency` period, in `currencyCode`. */
  @Column({
    name: 'base_salary',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformerNotNull,
  })
  baseSalary: number;

  @Column({ name: 'pay_frequency', type: 'enum', enum: PayFrequency, default: PayFrequency.MONTHLY })
  payFrequency: PayFrequency;

  @Column({ name: 'currency_code', length: 3, default: 'DOP' })
  currencyCode: string;
}
