import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';

/**
 * One bracket of the salaried income-tax (ISR) scale, in force for a country over a date range.
 *
 * ## Why the scale is data
 *
 * The DGII scale for salaried income is stated annually and, in the DR, has not been indexed for
 * years — which is precisely why the effective values must be a versioned table and not a literal:
 * when it finally is reindexed, a payslip for a prior period must still compute on the scale that
 * applied then. The same versioning as {@link StatutoryContribution}, for the same reason.
 *
 * Bounds are **annual** amounts (the DR scale is annual; the calculation annualises the monthly
 * taxable pay, finds the bracket, computes the annual tax and divides back to the period). Each
 * bracket carries the tax accumulated at its lower bound so the calculation is a single lookup plus
 * a marginal step, not a loop that can drift.
 *
 * Global reference data: no `organization_id`, outside RLS.
 */
@Entity('payroll_income_tax_brackets')
@Index('IDX_income_tax_bracket_lookup', ['countryCode', 'effectiveFrom', 'lowerAnnual'], {
  unique: true,
})
export class IncomeTaxBracket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'country_code', length: 2 })
  countryCode: string;

  @Column({ name: 'effective_from', type: 'date' })
  effectiveFrom: string;

  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo: string | null;

  /** Lower bound of the bracket, annual, inclusive. The exempt bracket starts at 0. */
  @Column({
    name: 'lower_annual',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformerNotNull,
  })
  lowerAnnual: number;

  /** Upper bound of the bracket, annual, inclusive. Null is the open-ended top bracket. */
  @Column({
    name: 'upper_annual',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  upperAnnual: number | null;

  /** Marginal rate applied within the bracket (0.15 = 15 %). The exempt bracket is 0. */
  @Column({
    name: 'rate',
    type: 'numeric',
    precision: 9,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  rate: number;

  /** Tax accumulated on all lower brackets, added to the marginal step within this one. */
  @Column({
    name: 'accumulated_tax',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  accumulatedTax: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
