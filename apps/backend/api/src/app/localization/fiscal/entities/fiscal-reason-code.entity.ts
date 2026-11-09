import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type FiscalReasonPurpose = 'INVOICE_CANCELLATION';

/**
 * A reason code from an authority's catalogue (audit 2026-11-07, FAC-INV-05): why a document was
 * annulled, as the return that declares it codes it. Regulatory reference data, global to every
 * tenant like `statutory_tax_rates`: with the legal basis it comes from and the period it is valid
 * for, so a catalogue that changes is a new row, not a release. The label is a catalogue key, never
 * prose. `invoices.cancellation_reason_code` is checked against it by trigger, for the tenant's
 * country.
 *
 * An open start (`effective_from` null) means «in force before any document this product holds»:
 * no start date is invented for a catalogue whose origin is not documented here.
 */
@Entity('fiscal_reason_codes')
@Index('UQ_fiscal_reason_codes_current', ['countryCode', 'purpose', 'code'], { unique: true, where: '"effective_to" IS NULL' })
@Check('CHK_fiscal_reason_codes_period', `"effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from"`)
@Check('CHK_fiscal_reason_codes_purpose', `"purpose" IN ('INVOICE_CANCELLATION')`)
export class FiscalReasonCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'country_code', type: 'varchar', length: 2 })
  countryCode: string;

  @Column({ type: 'varchar', length: 32 })
  purpose: FiscalReasonPurpose;

  /** The authority's own code, written verbatim into its return. */
  @Column({ type: 'varchar', length: 16 })
  code: string;

  @Column({ name: 'label_key', type: 'varchar', length: 160 })
  labelKey: string;

  @Column({ name: 'legal_basis', type: 'text' })
  legalBasis: string;

  @Column({ name: 'effective_from', type: 'date', nullable: true })
  effectiveFrom: string | null;

  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
