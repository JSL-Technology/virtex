import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * An email domain claimed by an organization for enterprise SSO routing (Home Realm
 * Discovery). A domain MUST be verified (DNS TXT challenge) before SSO can be enabled for
 * it — otherwise an org could claim a domain it does not own and hijack other users'
 * logins (anti-takeover control).
 */
@Entity({ name: 'organization_domains' })
@Index(['domain'], { unique: true })
export class OrganizationDomain {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** Lowercased domain, e.g. "acme.com". Unique across all organizations. */
  @Column()
  domain: string;

  @Column({ default: false })
  verified: boolean;

  /** Random token the org must publish as a DNS TXT record to prove ownership. */
  @Column({ name: 'verification_token' })
  verificationToken: string;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
