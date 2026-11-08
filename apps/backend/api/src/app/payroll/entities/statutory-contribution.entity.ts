import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';
// The base vocabulary lives with the jurisdiction strategies that define a country's statutory
// rules, so the jurisdictions module needs no import of payroll. Re-exported here so the payroll
// files that read it off the versioned rate table keep their import path.
import { ContributionBase } from '../../jurisdictions/contribution-regime';

export { ContributionBase };

/**
 * One social-security rate, in force for a country over a date range.
 *
 * ## Why this is a versioned table and not a constant
 *
 * The single most important payroll invariant: a rate is a fact about a *moment*, not about the
 * codebase. TSS resolutions change the AFP/SFS split and the caps by decree; when they do, a run
 * already processed under the old rate must keep it, and a run for a new period must pick up the new
 * one — automatically, from its date, with no code change. Hardcoding `0.0287` anywhere makes that
 * impossible and scatters the number across the module. So every rate lives here, keyed by
 * `(countryCode, code, effectiveFrom)`, and the calculation reads the row in force on the run's
 * period. Adding a country is inserting rows; correcting a rate is inserting a row.
 *
 * This is **global reference data** — the DR's rates are the same for every tenant — so the table
 * carries no `organization_id` and is deliberately outside row-level security, exactly like
 * `currency` and `coa_templates`.
 *
 * Rates are fractions (0.0287 = 2.87 %). Caps are expressed as a multiple of the minimum
 * contributory wage (see {@link StatutoryReference} key `MIN_WAGE_COTIZABLE`), because that is how
 * the law states them and it keeps the cap correct when the minimum wage is updated.
 */
@Entity('payroll_statutory_contributions')
@Index('IDX_statutory_contrib_lookup', ['countryCode', 'code', 'effectiveFrom'], { unique: true })
export class StatutoryContribution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'country_code', length: 2 })
  countryCode: string;

  /**
   * The contribution's code in the country's catalogue (`PayrollJurisdictionStrategy
   * .contributionConcepts`). Text, not an enum: the enum listed the four Dominican regimes as if
   * they were every country's (audit 2026-11-07, JUR-01).
   */
  @Column({ name: 'contribution_code', type: 'varchar', length: 32 })
  code: string;

  @Column({ name: 'effective_from', type: 'date' })
  effectiveFrom: string;

  /** Null means "still in force". A newer row supersedes rather than requiring this to be set. */
  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo: string | null;

  /** Employee share, withheld from the wage. Zero for employer-only regimes (SRL, INFOTEP levy). */
  @Column({
    name: 'employee_rate',
    type: 'numeric',
    precision: 9,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  employeeRate: number;

  /** Employer share, an expense the company bears on top of the wage. */
  @Column({
    name: 'employer_rate',
    type: 'numeric',
    precision: 9,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  employerRate: number;

  @Column({
    name: 'base',
    type: 'enum',
    enum: ContributionBase,
    default: ContributionBase.SALARY_CAPPED,
  })
  base: ContributionBase;

  /** Cap as a multiple of the minimum contributory wage. Null means uncapped. */
  @Column({
    name: 'cap_min_wage_multiplier',
    type: 'numeric',
    precision: 9,
    scale: 4,
    nullable: true,
    transformer: numericTransformer,
  })
  capMinWageMultiplier: number | null;

  /**
   * Floor as a multiple of the minimum contributory wage. Null means no floor. AFP/SFS carry a
   * floor of 1 (TSS will not accept a base below one minimum wage for a full-time worker); it is
   * only applied to a full-period base so a part-month worker is not over-charged.
   */
  @Column({
    name: 'floor_min_wage_multiplier',
    type: 'numeric',
    precision: 9,
    scale: 4,
    nullable: true,
    transformer: numericTransformer,
  })
  floorMinWageMultiplier: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
