import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';

/** The social-security regimes a contribution row can describe. */
export enum ContributionRegime {
  /** Pension fund — AFP (Administradora de Fondos de Pensiones). */
  AFP = 'AFP',
  /** Health — SFS/SDSS (Seguro Familiar de Salud). */
  SFS = 'SFS',
  /** Labour-risk insurance — SRL (Seguro de Riesgos Laborales), employer-borne. */
  SRL = 'SRL',
  /** Vocational-training levy — INFOTEP. */
  INFOTEP = 'INFOTEP',
}

/** What a rate is applied to. */
export enum ContributionBase {
  /** The salary, capped at a multiple of the minimum contributory wage. AFP/SFS/SRL work this way. */
  SALARY_CAPPED = 'SALARY_CAPPED',
  /** The whole payroll, uncapped. INFOTEP's employer levy works this way. */
  PAYROLL_UNCAPPED = 'PAYROLL_UNCAPPED',
}

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
 * `(countryCode, regime, effectiveFrom)`, and the calculation reads the row in force on the run's
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
@Index('IDX_statutory_contrib_lookup', ['countryCode', 'regime', 'effectiveFrom'], { unique: true })
export class StatutoryContribution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'country_code', length: 2 })
  countryCode: string;

  @Column({ name: 'regime', type: 'enum', enum: ContributionRegime })
  regime: ContributionRegime;

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
