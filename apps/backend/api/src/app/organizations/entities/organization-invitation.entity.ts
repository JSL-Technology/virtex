import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from './organization.entity';
import { User } from '../../users/entities/user.entity/user.entity';
import { Role } from '../../roles/entities/role.entity';

/** Where an invitation stands. Only `PENDING` can still change. */
export enum OrganizationInvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  REVOKED = 'REVOKED',
}

/**
 * A tenant asking an EXISTING account to join it.
 *
 * ## Why this is a request and not a membership
 *
 * One identity serves every tenant a person works with. Inviting an existing account used to write
 * the `user_organizations` row on the inviter's say-so, and membership is what the administration
 * endpoints authorise against — so a tenant could make any account on the platform "one of its
 * members" by typing an email address, and then act on it. Consent is now a separate, recorded
 * step that only the addressee can take, from their own authenticated session.
 *
 * A NEW account needs none of this: the inviting tenant creates it, is its home organization, and
 * the invitation token in the email is how its owner takes it over.
 *
 * The row carries `organization_id`, but it is read by the ADDRESSEE — from whichever tenant they
 * happen to be acting in — so it is classified cross-tenant in `tenant-table-classification.ts`
 * instead of receiving the tenant policy; every query here filters by the organization or by the
 * addressee explicitly.
 */
@Entity({ name: 'organization_invitations' })
@Index('IDX_organization_invitations_user_status', ['userId', 'status'])
@Index('IDX_organization_invitations_org_status', ['organizationId', 'status'])
// At most one live invitation per person and tenant: re-inviting refreshes it.
@Index('UQ_organization_invitations_pending', ['organizationId', 'userId'], {
  unique: true,
  where: `"status" = 'PENDING'`,
})
export class OrganizationInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_organization_invitations_org' })
  organization?: Organization;

  /** The addressee: an account that already exists. */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_organization_invitations_user' })
  user?: User;

  /** The role the addressee receives in `organization_id` on acceptance. */
  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id', foreignKeyConstraintName: 'FK_organization_invitations_role' })
  role?: Role;

  @Column({ name: 'invited_by_id', type: 'uuid', nullable: true })
  invitedById: string | null;

  @Column({
    type: 'enum',
    enum: OrganizationInvitationStatus,
    enumName: 'organization_invitation_status',
    default: OrganizationInvitationStatus.PENDING,
  })
  status: OrganizationInvitationStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
