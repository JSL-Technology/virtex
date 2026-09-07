import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '../../../organizations/entities/organization.entity';
import { numericTransformerNotNull } from '../../../common/database/numeric.transformer';

/** The level a rate is levied at. Their sum is what a buyer pays. */
export enum JurisdictionLevel {
  STATE = 'STATE',
  COUNTY = 'COUNTY',
  CITY = 'CITY',
  /** Transit authorities, stadium districts, special purpose districts. */
  SPECIAL = 'SPECIAL',
}

/**
 * Which address decides the rate.
 *
 * Most US states are destination-sourced: the rate is the buyer's. A minority are origin-sourced
 * for intrastate sales, where it is the seller's. Getting this wrong does not produce an error —
 * it produces a return that is wrong by the difference between two towns, every month.
 */
export enum SourcingRule {
  DESTINATION = 'DESTINATION',
  ORIGIN = 'ORIGIN',
}

/**
 * A rate the tenant is registered to collect, in one jurisdiction, over one period.
 *
 * ## Why this table exists
 *
 * `COUNTRY_TAX_SCHEMES` marks the United States and Brazil `configurationRequired` and
 * `allowedTaxFractions` therefore returned null for them — which meant **the client set the rate
 * on the request and nothing checked it**. For a product sold in the United States that is not a
 * gap in a feature: there was no jurisdiction determination, no destination sourcing, no record of
 * where the tenant has nexus, and no way for the tenant to state any of it.
 *
 * Building a rate table for twelve thousand US jurisdictions is not defensible, and this does not
 * try to: it holds the jurisdictions **this tenant is registered in**, which for the businesses
 * this product serves is a handful. A tenant with nexus in three states maintains three to nine
 * rows and gets correct determination; one that outgrows that connects a provider through
 * `TaxDeterminationProvider`, and this table is then the fallback rather than the source.
 *
 * Rates carry effective dates because they change by ordinance mid-year, and a document issued in
 * March must keep being priced at March's rate when it is credited in July.
 */
@Entity({ name: 'tax_jurisdictions' })
@Index('IDX_tax_jurisdictions_lookup', [
  'organizationId',
  'countryCode',
  'stateCode',
  'effectiveFrom',
])
@Check(
  'CHK_tax_jurisdictions_rate',
  '"rate" >= 0 AND "rate" <= 1 AND ("effective_to" IS NULL OR "effective_to" >= "effective_from")',
)
export class TaxJurisdiction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'organization_id',
    foreignKeyConstraintName: 'FK_tax_jurisdictions_organization',
  })
  organization: Organization;

  @Column({ name: 'country_code', length: 2 })
  countryCode: string;

  /** The first-level division's code — `TX`, `CA`, `SP`. Required: no rate is nationwide here. */
  @Column({ name: 'state_code', length: 8 })
  stateCode: string;

  /** Null on a state-level row. */
  @Column({ name: 'county', type: 'varchar', length: 120, nullable: true })
  county: string | null;

  /** Null on a state- or county-level row. */
  @Column({ name: 'city', type: 'varchar', length: 120, nullable: true })
  city: string | null;

  /**
   * The postal code this row applies to, where the tenant tracks rates that finely.
   *
   * Null means "everywhere in the named division". A ZIP is not a jurisdiction — one ZIP can
   * straddle two cities — so this narrows a row rather than defining one, and a row with a ZIP
   * only ever wins over one without when the ZIP matches.
   */
  @Column({ name: 'postal_code', type: 'varchar', length: 16, nullable: true })
  postalCode: string | null;

  @Column({ name: 'level', type: 'varchar', length: 10 })
  level: JurisdictionLevel;

  @Column({ length: 160 })
  name: string;

  /** As a fraction: `0.0825` is 8.25 %. */
  @Column('decimal', { precision: 9, scale: 6, transformer: numericTransformerNotNull })
  rate: number;

  /**
   * Whether the tenant is registered to collect here.
   *
   * A rate the tenant is not registered for is not charged. Post-*Wayfair* economic nexus is a
   * determination the tenant makes — it depends on their sales volume into the state, which this
   * product does not decide for them — so registration is recorded, not inferred. A destination in
   * a state with no registered row is sold untaxed, and the document records that it was.
   */
  @Column({ name: 'is_registered', default: true })
  isRegistered: boolean;

  /** Which address decides the rate for a sale into this state. Meaningful on STATE rows. */
  @Column({ name: 'sourcing', type: 'varchar', length: 12, default: SourcingRule.DESTINATION })
  sourcing: SourcingRule;

  @Column({ name: 'effective_from', type: 'date' })
  effectiveFrom: string;

  /** Null while current. A rate superseded by an ordinance keeps its own window. */
  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
