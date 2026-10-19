import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { User } from '../../users/entities/user.entity/user.entity';
import { Organization } from '../../organizations/entities/organization.entity';

/**
 * One person's acceptance of one edition of a legal document (QA C-07).
 *
 * A row per document and not a pair of columns on `users`: a new edition is accepted later
 * ALONGSIDE the old one rather than over it, and one identity can sign up several companies,
 * each signup its own acceptance. Written in the same transaction that materialises the account,
 * from what the signup recorded at the moment the box was ticked.
 */
@Entity({ name: 'legal_acceptances' })
@Index('IDX_legal_acceptances_user_document', ['userId', 'document'])
export class LegalAcceptance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Deleted with the person: an acceptance is theirs, and means nothing without them. */
  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_legal_acceptances_user' })
  user?: User;

  /** The company whose signup carried the acceptance. Null once that company is deleted. */
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  /**
   * NOT `@TenantOwned`: that cascades, and the person's acceptance must outlive the company it was
   * given for. The link is cleared instead.
   */
  @ManyToOne(() => Organization, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_legal_acceptances_organization' })
  organization?: Organization | null;

  /** `terms` or `privacy` — see `LEGAL_DOCUMENTS`. */
  @Column({ type: 'varchar', length: 16 })
  document: string;

  @Column({ type: 'varchar', length: 32 })
  version: string;

  @Column({ name: 'accepted_at', type: 'timestamptz' })
  acceptedAt: Date;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  /** Where the acceptance was given. `signup` today; a re-acceptance flow would add its own. */
  @Column({ type: 'varchar', length: 32, default: 'signup' })
  source: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
