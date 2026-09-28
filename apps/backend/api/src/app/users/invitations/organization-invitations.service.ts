import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  OrganizationInvitation,
  OrganizationInvitationStatus,
} from '../../organizations/entities/organization-invitation.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { MembershipService } from '../../organizations/services/membership.service';
import { User, UserStatus } from '../entities/user.entity/user.entity';
import { UserOrganization } from '../../organizations/entities/user-organization.entity';
import { RolesService } from '../../roles/roles.service';
import { AuthenticatedUser } from '../../security/principal';
import { Role } from '../../roles/entities/role.entity';
import { MailService } from '../../mail/mail.service';
import { UserCacheService } from '../../auth/modules/user-cache.service';
import { SaasService } from '../../saas/saas.service';
import { SaasResource } from '../../saas/enums/saas-resource.enum';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { replaceRolesInOrganization } from '../persistence/identity-writes';
import { NotFoundError } from '../../i18n/localized.exception';

/** How long an invitation stays answerable. Matches the set-your-password link of a new account. */
export const ORGANIZATION_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** An invitation as its ADDRESSEE sees it: who is asking, for what, until when. */
export interface ReceivedInvitationView {
  id: string;
  organizationId: string;
  organizationName: string;
  roleName: string;
  invitedByName: string | null;
  expiresAt: Date;
  createdAt: Date;
}

/** An invitation as the INVITING tenant sees it. */
export interface SentInvitationView {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  roleName: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Invitations to an EXISTING account: a request its addressee accepts or declines.
 *
 * The inviting tenant learns nothing about the account from this — not its roles elsewhere, its
 * home organization, its phone or its second factor — and gains no authority over it until the
 * person accepts. What acceptance grants is exactly a membership and the one role the invitation
 * named, both in the inviting tenant.
 */
@Injectable()
export class OrganizationInvitationsService {
  private readonly logger = new Logger(OrganizationInvitationsService.name);

  constructor(
    @InjectRepository(OrganizationInvitation)
    private readonly invitations: Repository<OrganizationInvitation>,
    private readonly membershipService: MembershipService,
    private readonly mailService: MailService,
    private readonly userCacheService: UserCacheService,
    private readonly saasService: SaasService,
    private readonly dataSource: DataSource,
    private readonly rolesService: RolesService,
  ) {}

  /**
   * Ask an existing account to join `organizationId` with `role`.
   *
   * Idempotent per person and tenant: a second invitation while one is pending refreshes the role
   * and the expiry of the first instead of stacking a new request. Already being a member is not an
   * error and not an oracle — the same receipt comes back and nothing is sent.
   *
   */
  async invite(
    user: Pick<User, 'id' | 'firstName' | 'email' | 'preferredLanguage'>,
    organizationId: string,
    role: Role,
    actor: AuthenticatedUser,
  ): Promise<OrganizationInvitation | null> {
    // Checked here as well as by the caller: an invitation IS a pending delegation, and this
    // service is the one place that records it.
    this.rolesService.assertCanAssignRole(actor, role);

    if (await this.membershipService.hasMembershipRow(user.id, organizationId)) {
      this.logger.log(
        { event: 'invite_existing_member', organizationId, userId: user.id },
        'Invitation for somebody who already belongs to this organization; nothing to do.',
      );
      return null;
    }

    const expiresAt = new Date(Date.now() + ORGANIZATION_INVITATION_TTL_MS);
    const pending = await this.invitations.findOne({
      where: { organizationId, userId: user.id, status: OrganizationInvitationStatus.PENDING },
    });

    const invitation = pending ?? this.invitations.create({ organizationId, userId: user.id });
    invitation.roleId = role.id;
    invitation.invitedById = actor.id;
    invitation.expiresAt = expiresAt;
    invitation.status = OrganizationInvitationStatus.PENDING;
    const saved = await this.invitations.save(invitation);

    const organization = await this.dataSource
      .getRepository(Organization)
      .findOne({ where: { id: organizationId }, select: ['id', 'legalName'] });

    try {
      await this.mailService.sendOrganizationInvitationEmail(
        user as User,
        organization?.legalName ?? '',
      );
    } catch (error) {
      // The invitation exists and is listed in the addressee's session; a queue outage must not
      // turn a recorded request into an error the administrator would retry into a duplicate.
      this.logger.error(
        { event: 'organization_invitation_email_not_queued', invitationId: saved.id },
        `Invitation recorded but its email could not be queued: ${(error as Error).message}`,
      );
    }

    return saved;
  }

  /** The invitations waiting for this person's answer. */
  async listReceived(userId: string): Promise<ReceivedInvitationView[]> {
    const rows = await this.invitations
      .createQueryBuilder('inv')
      .innerJoin(Organization, 'org', 'org.id = inv.organizationId')
      .innerJoin(Role, 'role', 'role.id = inv.roleId')
      .leftJoin(User, 'inviter', 'inviter.id = inv.invitedById')
      .where('inv.userId = :userId', { userId })
      .andWhere('inv.status = :status', { status: OrganizationInvitationStatus.PENDING })
      .andWhere('inv.expiresAt > now()')
      .select([
        'inv.id AS id',
        'inv.organizationId AS "organizationId"',
        'org.legalName AS "organizationName"',
        'role.name AS "roleName"',
        `NULLIF(TRIM(CONCAT(inviter.firstName, ' ', inviter.lastName)), '') AS "invitedByName"`,
        'inv.expiresAt AS "expiresAt"',
        'inv.createdAt AS "createdAt"',
      ])
      .orderBy('inv.createdAt', 'DESC')
      .getRawMany<ReceivedInvitationView>();
    return rows;
  }

  /** The invitations this tenant has sent and nobody has answered yet. */
  async listSent(organizationId: string): Promise<SentInvitationView[]> {
    return this.invitations
      .createQueryBuilder('inv')
      .innerJoin(User, 'u', 'u.id = inv.userId')
      .innerJoin(Role, 'role', 'role.id = inv.roleId')
      .where('inv.organizationId = :organizationId', { organizationId })
      .andWhere('inv.status = :status', { status: OrganizationInvitationStatus.PENDING })
      .andWhere('inv.expiresAt > now()')
      .select([
        'inv.id AS id',
        'u.email AS email',
        'u.firstName AS "firstName"',
        'u.lastName AS "lastName"',
        'inv.roleId AS "roleId"',
        'role.name AS "roleName"',
        'inv.expiresAt AS "expiresAt"',
        'inv.createdAt AS "createdAt"',
      ])
      .orderBy('inv.createdAt', 'DESC')
      .getRawMany<SentInvitationView>();
  }

  /**
   * Accept: the membership and the named role, in the inviting tenant, and nothing else.
   *
   * Everything is re-checked at acceptance rather than trusted from invitation time: the row must
   * still be pending, unexpired and addressed to THIS person, the role must still exist in the
   * inviting tenant, and the tenant must still have a seat. The writes happen as that tenant, so
   * the row-level policies that guard its data see the tenant they expect.
   */
  async accept(invitationId: string, userId: string): Promise<{ organizationId: string }> {
    const invitation = await this.findAnswerable(invitationId, userId);

    await runAsTenantJob(this.dataSource, invitation.organizationId, () =>
      this.dataSource.transaction(async (manager) => {
        const role = await manager.getRepository(Role).findOne({
          where: { id: invitation.roleId, organizationId: invitation.organizationId },
        });
        if (!role) {
          throw new NotFoundError('users.invitation_not_found_or_expired');
        }

        // The delegation check ran when the invitation was sent, against the inviter's rights at
        // that moment. A week later they may have lost them — been demoted, suspended, removed.
        // The grant happens NOW, so it is checked against who the inviter is now.
        await this.assertInviterMayStillGrant(manager, invitation, role);

        await this.saasService.enforceLimit(manager, invitation.organizationId, SaasResource.USERS);
        await this.membershipService.grant(userId, invitation.organizationId, manager);
        // role-assignment-allow: delegation re-checked just above by assertInviterMayStillGrant,
        // which calls rolesService.assertCanAssignRole against the inviter's CURRENT rights.
        await replaceRolesInOrganization(manager, userId, invitation.organizationId, [role.id]);

        const claimed = await manager.getRepository(OrganizationInvitation).update(
          { id: invitation.id, status: OrganizationInvitationStatus.PENDING },
          { status: OrganizationInvitationStatus.ACCEPTED, respondedAt: new Date() },
        );
        if (!claimed.affected) {
          // Answered concurrently; roll the grant back rather than apply it twice.
          throw new NotFoundError('users.invitation_not_found_or_expired');
        }
      }),
    );

    await this.userCacheService.clearUserSession(userId);
    this.logger.log(
      { event: 'organization_invitation_accepted', invitationId, userId, organizationId: invitation.organizationId },
      'Invitation accepted',
    );
    return { organizationId: invitation.organizationId };
  }

  /**
   * The inviter must still be an active, unsuspended member of the tenant who may grant `role`.
   *
   * Otherwise the invitation is treated as gone: from the addressee's side, a request whose
   * sender no longer stands behind it is not a request.
   */
  private async assertInviterMayStillGrant(
    manager: EntityManager,
    invitation: OrganizationInvitation,
    role: Role,
  ): Promise<void> {
    if (!invitation.invitedById) {
      throw new NotFoundError('users.invitation_not_found_or_expired');
    }
    const inviter = await manager
      .getRepository(User)
      .createQueryBuilder('user')
      .innerJoin(
        UserOrganization,
        'membership',
        'membership.user_id = user.id AND membership.organization_id = :organizationId AND membership.suspended_at IS NULL',
        { organizationId: invitation.organizationId },
      )
      .leftJoinAndSelect(
        'user.roles',
        'roles',
        'roles.organizationId = :organizationId OR roles.organizationId IS NULL',
        { organizationId: invitation.organizationId },
      )
      .where('user.id = :id', { id: invitation.invitedById })
      .andWhere('user.status = :status', { status: UserStatus.ACTIVE })
      .getOne();
    if (!inviter) {
      throw new NotFoundError('users.invitation_not_found_or_expired');
    }
    const permissions = [...new Set((inviter.roles ?? []).flatMap((r) => r.permissions ?? []))];
    try {
      this.rolesService.assertCanAssignRole(
        { id: inviter.id, permissions } as AuthenticatedUser,
        role,
      );
    } catch {
      throw new NotFoundError('users.invitation_not_found_or_expired');
    }
  }

  /** Decline. Nothing is granted and the inviting tenant sees the request disappear. */
  async decline(invitationId: string, userId: string): Promise<void> {
    const invitation = await this.findAnswerable(invitationId, userId);
    await this.invitations.update(
      { id: invitation.id, status: OrganizationInvitationStatus.PENDING },
      { status: OrganizationInvitationStatus.DECLINED, respondedAt: new Date() },
    );
  }

  /** Withdraw an invitation this tenant sent. */
  async revoke(invitationId: string, organizationId: string): Promise<void> {
    const result = await this.invitations.update(
      { id: invitationId, organizationId, status: OrganizationInvitationStatus.PENDING },
      { status: OrganizationInvitationStatus.REVOKED, respondedAt: new Date() },
    );
    if (!result.affected) {
      throw new NotFoundError('users.invitation_not_found_or_expired');
    }
  }

  /**
   * The invitation, if this person may still answer it.
   *
   * "Not found", "not yours", "already answered" and "expired" are one answer, so the endpoint
   * cannot be used to learn anything about invitations addressed to somebody else.
   */
  private async findAnswerable(invitationId: string, userId: string): Promise<OrganizationInvitation> {
    const invitation = await this.invitations.findOne({
      where: { id: invitationId, userId, status: OrganizationInvitationStatus.PENDING },
    });
    if (!invitation || invitation.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundError('users.invitation_not_found_or_expired');
    }
    return invitation;
  }
}
