import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

export enum PendingRegistrationStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
  /**
   * Payment succeeded but the account could not be created.
   *
   * This state had no representation, and its absence is what made an orphan payment
   * unrecoverable: a duplicate email, a tax-id collision or a missing plan rolled the
   * materialisation transaction back, the customer was left charged with no account, and
   * nothing recorded that it had happened. A row in this state is a support queue.
   */
  FAILED = 'failed',
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

  /**
   * When the signup stops being redeemable, and when its personal data stops being kept.
   *
   * The column was written and then read by nothing: no lookup checked it and no job purged by
   * it. So every abandoned signup left a name, an email, a phone number, a tax identifier, a
   * full fiscal address and an Argon2 password hash on record indefinitely, for somebody who
   * never became a customer. `PendingRegistrationCleanupService` now enforces it.
   */
  @Index('IDX_pending_registrations_expires_at')
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /** Why materialisation failed, for the operator who has to resolve the charge. */
  @Column({ name: 'failure_reason', type: 'varchar', length: 500, nullable: true })
  failureReason: string | null;

  /** The Stripe subscription created for a payment whose account could not be materialised. */
  /**
   * The organization this signup produced, once it has produced one.
   *
   * Completion used to be judged by looking up `users` by email: if a user with that address
   * existed, the signup was treated as already done. That reasoning only holds while one email
   * can own exactly one tenant — and it stopped holding the moment an existing customer was
   * allowed to register a second company, because then the lookup finds their FIRST account and
   * the second one is silently never created, after payment.
   *
   * Idempotency is now a fact about this row: it either has an organization or it does not.
   */
  // Named so the entity and the migration describe ONE index rather than two on the same column.
  @Index('IDX_pending_registrations_organization_id')
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  /**
   * Deleted with the tenant. This row holds the applicant's argon2 hash, their full fiscal
   * identity and their address; once the account it produced is gone, keeping it is retention
   * of personal data with no purpose left to serve.
   */
  @ManyToOne(() => Organization, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization | null;

  @Column({ name: 'orphaned_subscription_id', type: 'varchar', nullable: true })
  orphanedSubscriptionId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
