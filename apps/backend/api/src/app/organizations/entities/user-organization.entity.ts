import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Organization } from './organization.entity';
import { User } from '../../users/entities/user.entity/user.entity';

/**
 * A person's membership of a tenant.
 *
 * The table existed — created by migration, backfilled, indexed — and was then read by one raw
 * SQL query and written by nothing. So the platform had the shape of multi-tenancy and none of the
 * behaviour: a user belonged to exactly the organization stored on their row, and the join table
 * held only whatever the backfill had put there on the day it ran.
 *
 * Modelling it as an entity is what makes the membership writable, transactional with the rest of
 * registration and invitation, and visible to the permission logic that has to scope roles by it.
 *
 * The identity model is one user row per person, not one per (person, tenant). That is forced by
 * the data: `users.email` is globally unique, so a second tenant inviting someone who already has
 * an account anywhere on the platform failed at the database with
 * `duplicate key value violates unique constraint "UQ_97672ac88f789774dd47f7c8be3"` — a 500, not a
 * message — because the invite path's own pre-check scoped its lookup by organization and could
 * never see the conflict. It is also the model credentials demand: a person has one password and
 * one set of MFA factors, not one per customer they work with.
 */
@Entity({ name: 'user_organizations' })
export class UserOrganization {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  @Index('IDX_user_organizations_user')
  userId: string;

  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  @Index('IDX_user_organizations_org')
  organizationId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /**
   * Set when THIS tenant has suspended the person, null while the membership is live.
   *
   * A tenant that is not the person's home organization has no authority over the identity — it
   * cannot block the account, which would cut the person off from every other tenant too. What it
   * can do is stop the person acting inside it, and this is that switch. A suspended membership
   * grants nothing: `MembershipService` leaves it out of every access decision, while the
   * administration screen still lists it so it can be restored.
   */
  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_user_organizations_user' })
  user: User;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'organization_id',
    foreignKeyConstraintName: 'FK_user_organizations_org',
  })
  organization: Organization;
}
