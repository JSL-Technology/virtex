import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

/** The named scalars payroll needs, versioned like every other parameter. */
export enum StatutoryReferenceKey {
  /** Minimum contributory wage — the unit the AFP/SFS/SRL caps are multiples of. */
  MIN_WAGE_COTIZABLE = 'MIN_WAGE_COTIZABLE',
  /** ISR annual exempt amount, kept explicit for reporting even though it is the first bracket. */
  ISR_ANNUAL_EXEMPT = 'ISR_ANNUAL_EXEMPT',
  /**
   * Employee INFOTEP levy on the year-end bonus (regalía), as a fraction (0.005 = 0.5 %). Versioned
   * here rather than hardcoded in the christmas-bonus path. Its `value` is the rate; `currencyCode`
   * is ignored for this key.
   */
  BONUS_EMPLOYEE_LEVY_RATE = 'BONUS_EMPLOYEE_LEVY_RATE',
}

/**
 * A single versioned scalar parameter for a country (e.g. the minimum contributory wage).
 *
 * The caps on AFP/SFS/SRL are stated as multiples of the minimum contributory wage, so that figure
 * has to live somewhere versioned rather than baked into the cap of each contribution — when it is
 * raised, every cap moves with it and nothing has to be re-entered. Global reference data, outside
 * RLS.
 */
@Entity('payroll_statutory_references')
@Index('IDX_statutory_reference_lookup', ['countryCode', 'key', 'effectiveFrom'], { unique: true })
export class StatutoryReference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'country_code', length: 2 })
  countryCode: string;

  @Column({ name: 'key', type: 'enum', enum: StatutoryReferenceKey })
  key: StatutoryReferenceKey;

  @Column({ name: 'effective_from', type: 'date' })
  effectiveFrom: string;

  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo: string | null;

  @Column({
    name: 'value',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformerNotNull,
  })
  value: number;

  @Column({ name: 'currency_code', length: 3, default: 'DOP' })
  currencyCode: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
