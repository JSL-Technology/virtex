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

  @Column({ name: 'tax_id', nullable: true })
  taxId: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  city: string;

  /**
   * First-level administrative division. A coded value (`CMX`, `TX`, `32`) where the country
   * publishes a catalogue, free text otherwise — see `country-profiles.ts`.
   */
  @Column({ nullable: true })
  state: string;

  @Column({ name: 'postal_code', nullable: true })
  postalCode: string;

  /**
   * ISO 3166-1 alpha-2. Registration never used to set this, so every tenant in the database had
   * a null country while its fiscal region said otherwise — two sources for one fact, one of them
   * always empty.
   */
  @Column({ nullable: true })
  country: string;

  /** Self-reported headcount band, collected at signup. */
  @Column({ name: 'company_size', nullable: true })
  companySize: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  website: string;

  @Column({ nullable: true })
  industry: string;

  @Column({ name: 'logo_url', nullable: true })
  logoUrl: string;

  /**
   * The tenant's fiscal region. A real uuid with a real foreign key: it was a bare `varchar` with
   * no constraint, so a value referencing no row was storable, and the resulting tenant had no
   * chart of accounts, no taxes and no fiscal identity.
   */
  @Column({ name: 'fiscal_region_id', type: 'uuid', nullable: true })
  fiscalRegionId: string;

  @ManyToOne(() => FiscalRegion, { nullable: true, onDelete: 'RESTRICT' })
  // Named explicitly so the constraint the entity declares and the one the migration creates are
  // the same object; otherwise every `migration:generate` proposes dropping and recreating it.
  @JoinColumn({ name: 'fiscal_region_id', foreignKeyConstraintName: 'FK_organizations_fiscal_region' })
  fiscalRegion: FiscalRegion;

  @Column({ name: 'stripe_customer_id', nullable: true })
  externalCustomerId: string;

  @Column({ name: 'stripe_subscription_id', nullable: true })
  externalSubscriptionId: string;

  @Column({ name: 'subscription_status', nullable: true })
  subscriptionStatus: string;

  @Column({ name: 'subscription_period_start', type: 'timestamptz', nullable: true })
  subscriptionPeriodStart: Date;

  @Column({ name: 'subscription_period_end', type: 'timestamptz', nullable: true })
  subscriptionPeriodEnd: Date;

  @Column({ name: 'grace_period_end', type: 'timestamptz', nullable: true })
  gracePeriodEnd: Date;

  @Column({ default: 'UTC' })
  timezone: string;

  @Column({ name: 'plan_id', nullable: true })
  planId: string;

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
