import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

export enum PendingRegistrationStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
}

/**
 * Holds a fully-validated registration awaiting successful payment. The account
 * (organization + user) is only materialized once Stripe confirms the checkout,
 * so abandoned signups never create real accounts. The password is stored
 * already hashed (argon2); email/phone are pre-verified before a row is created.
 */
@Entity({ name: 'pending_registrations' })
export class PendingRegistration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  email: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ name: 'phone_verified', default: false })
  phoneVerified: boolean;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ name: 'organization_name' })
  organizationName: string;

  @Column({ name: 'tax_id', type: 'varchar', nullable: true })
  taxId: string | null;

  @Column({ name: 'fiscal_region_id', type: 'varchar', nullable: true })
  fiscalRegionId: string | null;

  @Column({ type: 'varchar', nullable: true })
  industry: string | null;

  @Column({ name: 'company_size', type: 'varchar', nullable: true })
  companySize: string | null;

  @Column({ type: 'varchar', nullable: true })
  address: string | null;

  @Column({ name: 'plan_slug' })
  planSlug: string;

  @Index()
  @Column({ name: 'stripe_session_id', type: 'varchar', nullable: true })
  stripeSessionId: string | null;

  @Column({ type: 'varchar', default: PendingRegistrationStatus.PENDING })
  status: PendingRegistrationStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
