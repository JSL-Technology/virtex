import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformerNotNull } from '../../../common/database/numeric.transformer';

/**
 * One consumption-tax rate a country's law levies, over the dates it is in force (audit 2026-11-07,
 * LOC-06, FAC-TX-03; pattern SP-03).
 *
 * The rates of the nineteen markets were constants in `country-tax-schemes.ts` with no dates, and
 * the tenant's `taxes` table had no `effective_from/to`, so a rate change — Ecuador's IVA went from
 * 12 % to 15 % on 1 April 2024 — could only be made by a release that also rewrote the past: an
 * invoice dated March 2024 was validated against 15 %. Each row here is a fact about a period:
 * the rate, the dates, and the instrument that sets it (`legalBasis`). A document is validated
 * against the rows in force on ITS date, never "the current one". A new rate is a new row ending
 * the previous one — never an edit. Overlapping periods for the same tax are refused by a trigger.
 *
 * Global reference data, the same for every tenant, like `payroll_statutory_contributions`: no
 * `organization_id`, no row-level security, read-only to the application role.
 */
@Entity('statutory_tax_rates')
@Index('UQ_statutory_tax_rates_version', ['countryCode', 'taxCode', 'effectiveFrom'], { unique: true })
@Check('CHK_statutory_tax_rates_period', `"effective_to" IS NULL OR "effective_to" >= "effective_from"`)
@Check('CHK_statutory_tax_rates_rate', `"rate" >= 0 AND "rate" <= 100`)
export class StatutoryTaxRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'country_code', type: 'varchar', length: 2 })
  countryCode: string;

  /** Stable code of the tax within the country (`ITBIS_GENERAL`, `IVA_REDUCED`…). */
  @Column({ name: 'tax_code', type: 'varchar', length: 40 })
  taxCode: string;

  /** The name the authority uses, as the tenant's catalogue is seeded with it. */
  @Column({ type: 'varchar', length: 80 })
  name: string;

  /** A percentage, as the tenant's `taxes.rate` stores it: 18 means 18 %. */
  @Column({ type: 'numeric', precision: 7, scale: 4, transformer: numericTransformerNotNull })
  rate: number;

  @Column({ name: 'effective_from', type: 'date' })
  effectiveFrom: string;

  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo: string | null;

  /** The law, decree or resolution that sets the rate — what an accountant confirms it against. */
  @Column({ name: 'legal_basis', type: 'text' })
  legalBasis: string;

  /** When the instrument was published in the official gazette, where known. */
  @Column({ name: 'published_on', type: 'date', nullable: true })
  publishedOn: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
