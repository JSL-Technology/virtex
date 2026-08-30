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

  // Named explicitly so the index the entity declares and the one the migration creates are
  // the same object. With TypeORM's generated name they were two indexes on one column, and
  // every `migration:generate` proposed dropping the hand-named one.
  @Index('IDX_pending_registrations_email')
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

  /** Mirrors `organizations.taxpayer_kind`; see the note on this entity about what it captures. */
  @Column({ name: 'taxpayer_kind', type: 'varchar', length: 16, nullable: true })
  taxpayerKind: string | null;

  /** Mirrors `organizations.fiscal_profile`. */
  @Column({ name: 'fiscal_profile', type: 'jsonb', nullable: true })
  fiscalProfile: Record<string, string> | null;

  @Column({ name: 'fiscal_region_id', type: 'varchar', nullable: true })
  fiscalRegionId: string | null;

  @Column({ type: 'varchar', nullable: true })
  industry: string | null;

  @Column({ name: 'company_size', type: 'varchar', nullable: true })
  companySize: string | null;

  /**
   * The fiscal address, structured.
   *
   * A pending registration is replayed into a real tenant hours later, so anything not captured
   * here is lost: the payload that was validated at step one is the only record of it. The single
   * `address` line this used to hold could not satisfy any of the electronic-invoicing regimes the
   * supported markets mandate.
   */
  @Column({ type: 'varchar', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  @Column({ type: 'varchar', nullable: true })
  state: string | null;

  @Column({ name: 'postal_code', type: 'varchar', nullable: true })
  postalCode: string | null;

  /** ISO 3166-1 alpha-2. Authoritative: the fiscal region is resolved from it. */
  @Column({ name: 'country_code', type: 'varchar', length: 2, nullable: true })
  countryCode: string | null;

  @Column({ name: 'plan_slug' })
  planSlug: string;

  @Index('IDX_pending_registrations_session')
  @Column({ name: 'stripe_session_id', type: 'varchar', nullable: true })
  stripeSessionId: string | null;

  @Column({ type: 'varchar', default: PendingRegistrationStatus.PENDING })
  status: PendingRegistrationStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
