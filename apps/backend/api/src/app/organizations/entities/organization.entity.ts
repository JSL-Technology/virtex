import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { OrganizationSubsidiary } from './organization-subsidiary.entity';
import { Plan } from '../../saas/entities/plan.entity';
import { FiscalRegion } from '../../localization/entities/fiscal-region.entity';

@Entity('organizations')
@Index(['taxId', 'fiscalRegionId'], { unique: true, where: '"tax_id" IS NOT NULL' })
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'legal_name' })
  legalName: string;

  @Column({ type: 'varchar', name: 'tax_id', nullable: true })
  taxId: string | null;

  /**
   * Whether the tenant is a legal entity or a natural person.
   *
   * Not cosmetic: it selects which identifier scheme `tax_id` was validated against, which
   * `RegimenFiscal` options the SAT catalogue offers, and which invoice class AFIP permits.
   */
  @Column({ type: 'varchar', name: 'taxpayer_kind', length: 16, nullable: true })
  taxpayerKind: string | null;

  /**
   * The country's remaining fiscal data, keyed by `FiscalFieldSpec.key`.
   *
   * Régimen fiscal for Mexico, condición frente al IVA and punto de venta for Argentina,
   * responsabilidades fiscales for Colombia, CRT and inscrição estadual for Brazil, giro and
   * código de actividad for Chile, ubigeo for Peru. Each regime stamps these into the document it
   * issues, so a tenant without them cannot invoice — which is why they are collected at signup
   * rather than asked for afterwards.
   */
  @Column({ type: 'jsonb', name: 'fiscal_profile', nullable: true })
  fiscalProfile: Record<string, string> | null;

  /**
   * When the tenant's fiscal identifier was last confirmed to be canonical.
   *
   * NULL means it is not trusted. Rows created before the destructive
   * `taxId.replace(/[^\d]/g, '')` was removed carry an identifier whose letters and check
   * characters were deleted — an RFC reduced to its date of incorporation, a RUT without its `K`,
   * a RIF without its type letter — and no migration can reconstruct them. Rather than let a
   * corrupt value look authoritative, those rows are marked unverified and the tenant is asked to
   * confirm before the product issues anything on their behalf.
   */
  @Column({ type: 'timestamptz', name: 'tax_id_verified_at', nullable: true })
  taxIdVerifiedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  /**
   * First-level administrative division. A coded value (`CMX`, `TX`, `32`) where the country
   * publishes a catalogue, free text otherwise — see `country-profiles.ts`.
   */
  @Column({ type: 'varchar', nullable: true })
  state: string | null;

  @Column({ type: 'varchar', name: 'postal_code', nullable: true })
  postalCode: string | null;

  /**
   * ISO 3166-1 alpha-2. Registration never used to set this, so every tenant in the database had
   * a null country while its fiscal region said otherwise — two sources for one fact, one of them
   * always empty.
   */
  @Column({ type: 'varchar', nullable: true })
  country: string | null;

  /** Self-reported headcount band, collected at signup. */
  @Column({ type: 'varchar', name: 'company_size', nullable: true })
  companySize: string | null;

  /**
   * Trade name, when it differs from the legal one. `NombreComercial` is an element of the e-CF and
   * of the printed representation; without it a customer sees a legal name they do not recognise.
   */
  @Column({ type: 'varchar', name: 'commercial_name', nullable: true })
  commercialName: string | null;

  /** Billing contact address. `CorreoEmisor` on the comprobante, and where the copy is sent. */
  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  website: string | null;

  @Column({ type: 'varchar', nullable: true })
  industry: string | null;

  @Column({ type: 'varchar', name: 'logo_url', nullable: true })
  logoUrl: string | null;

  /**
   * The tenant's fiscal region. A real uuid with a real foreign key: it was a bare `varchar` with
   * no constraint, so a value referencing no row was storable, and the resulting tenant had no
   * chart of accounts, no taxes and no fiscal identity.
   */
  @Column({ name: 'fiscal_region_id', type: 'uuid', nullable: true })
  fiscalRegionId: string | null;

  @ManyToOne(() => FiscalRegion, { nullable: true, onDelete: 'RESTRICT' })
  // Named explicitly so the constraint the entity declares and the one the migration creates are
  // the same object; otherwise every `migration:generate` proposes dropping and recreating it.
  @JoinColumn({ name: 'fiscal_region_id', foreignKeyConstraintName: 'FK_organizations_fiscal_region' })
  fiscalRegion: FiscalRegion;

  @Column({ type: 'varchar', name: 'stripe_customer_id', nullable: true })
  externalCustomerId: string | null;

  @Column({ type: 'varchar', name: 'stripe_subscription_id', nullable: true })
  externalSubscriptionId: string | null;

  @Column({ type: 'varchar', name: 'subscription_status', nullable: true })
  subscriptionStatus: string | null;

  @Column({ name: 'subscription_period_start', type: 'timestamptz', nullable: true })
  subscriptionPeriodStart: Date | null;

  @Column({ name: 'subscription_period_end', type: 'timestamptz', nullable: true })
  subscriptionPeriodEnd: Date | null;

  @Column({ name: 'grace_period_end', type: 'timestamptz', nullable: true })
  gracePeriodEnd: Date | null;

  @Column({ default: 'UTC' })
  timezone: string;

  @Column({ type: 'uuid', name: 'plan_id', nullable: true })
  planId: string | null;

  @ManyToOne(() => Plan, { nullable: true })
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @OneToMany(() => OrganizationSubsidiary, sub => sub.parent)
  subsidiaries: OrganizationSubsidiary[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
