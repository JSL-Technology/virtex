import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Organization } from './organization.entity';

/**
 * An email domain claimed by an organization for enterprise SSO routing (Home Realm
 * Discovery). A domain MUST be verified (DNS TXT challenge) before SSO can be enabled for
 * it — otherwise an org could claim a domain it does not own and hijack other users'
 * logins (anti-takeover control).
 *
 * Unique among VERIFIED claims only: a pending claim proves nothing and must not be able to
 * block the real owner. Pending claims are private to their organization and expire; verified
 * ones are re-checked against DNS (see `SsoDomainReverificationService`). The migration
 * `SsoDomainClaims1789007500000` explains the read-only routing policy.
 */
@Entity({ name: 'organization_domains' })
@Index('UQ_organization_domains_verified_domain', ['domain'], { unique: true, where: '"verified" = true' })
@Index('UQ_organization_domains_org_domain', ['organizationId', 'domain'], { unique: true })
export class OrganizationDomain {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /**
   * A verified `domain` is globally unique, so a claim left behind by a deleted tenant would
   * block the domain for everyone else — permanently, and with no tenant left to release it.
   */
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;

  /** Lowercased domain, e.g. "acme.com". Unique across organizations once verified. */
  @Column()
  domain: string;

  @Column({ default: false })
  verified: boolean;

  /** Random token the org must publish as a DNS TXT record to prove ownership. */
  @Column({ name: 'verification_token' })
  verificationToken: string;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  /** When the DNS record was last re-checked. Null until the first periodic check. */
  @Column({ name: 'last_checked_at', type: 'timestamptz', nullable: true })
  lastCheckedAt: Date | null;

  /** Consecutive re-checks that did not find the record; verification lapses at a threshold. */
  @Column({ name: 'failed_checks', type: 'integer', default: 0 })
  failedChecks: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
