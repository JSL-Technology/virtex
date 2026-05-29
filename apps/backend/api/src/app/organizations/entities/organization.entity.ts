import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { OrganizationSubsidiary } from './organization-subsidiary.entity';

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

  @Column({ nullable: true })
  country: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  website: string;

  @Column({ nullable: true })
  industry: string;

  @Column({ name: 'logo_url', nullable: true })
  logoUrl: string;

  @Column({ name: 'fiscal_region_id', nullable: true })
  fiscalRegionId: string;

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

  @OneToMany(() => OrganizationSubsidiary, sub => sub.parent)
  subsidiaries: OrganizationSubsidiary[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
