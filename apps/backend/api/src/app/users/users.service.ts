
import { Injectable, Inject, forwardRef, NotFoundException, BadRequestException, ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { User } from './entities/user.entity/user.entity';
import { UserStatus } from './entities/user.entity/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { InviteUserDto } from './entities/user.entity/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RequestEmailChangeDto, ConfirmEmailChangeDto } from './dto/email-change.dto';
import { MailService } from '../mail/mail.service';
import { RolesService } from '../roles/roles.service';
import { Role } from '../roles/entities/role.entity';
import * as crypto from 'crypto';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { PasswordService } from '../auth/services/password.service';
import { UserSecurity } from './entities/user-security.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SaasService } from '../saas/saas.service';
import { SaasResource } from '../saas/enums/saas-resource.enum';
import { MembershipService } from '../organizations/services/membership.service';
import { UserOrganization } from '../organizations/entities/user-organization.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { hasPermission } from '@virteex/shared/util-auth';
import { SessionService } from '../auth/services/session.service';
import { AuditTrailService } from '../audit/audit.service';

/** One row of a user's activity, as the administration screen renders it. */
export interface UserActivityEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  at: Date;
  ipAddress: string | null;
  details: Record<string, unknown> | null;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
    private readonly rolesService: RolesService,
    private readonly mailService: MailService,
    private readonly userCacheService: UserCacheService,
    private readonly passwordService: PasswordService,
    private readonly eventEmitter: EventEmitter2,
    private readonly saasService: SaasService,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => SessionService))
    private readonly sessionService: SessionService,
    private readonly membershipService: MembershipService,
    private readonly auditTrailService: AuditTrailService,
  ) {}

  /**
   * Fields a user may change about themselves through the profile screen.
   *
   * This is an explicit allow-list rather than `Object.assign(user, dto)`. The previous version
   * copied whatever the DTO carried and relied entirely on the global ValidationPipe
   * (`whitelist: true`) to strip anything dangerous — a single point of failure sitting outside
   * this service. Any caller that reached it without the pipe (an internal call, a controller
   * registered without the global pipe, a future refactor) could rewrite `email`, `status`,
   * `organizationId` or `roles` through what looks like a harmless profile update.
   *
   * Email is deliberately absent: changing it is a two-step, token-confirmed operation
   * (requestEmailChange + confirmEmailChange), because a silent change would let a hijacked
   * session redirect account recovery and lock out the real owner.
   */
  private static readonly SELF_EDITABLE_PROFILE_FIELDS = [
    'firstName',
    'lastName',
    'phone',
    'jobTitle',
    'avatarUrl',
    'preferredLanguage',
  ] as const;

  async updateProfile(
    id: string,
    updateProfileDto: UpdateProfileDto,
    organizationId: string,
  ): Promise<User> {
    // Tenant-scoped so the response carries the roles for THIS tenant, matching what the profile
    // screen renders and what `GET /users/profile` returns.
    const user = await this.findOne(id, organizationId);

    // A new phone number is unverified until proven, otherwise SMS-based recovery could be
    // pointed at an attacker-controlled number without any challenge.
    if (updateProfileDto.phone !== undefined && updateProfileDto.phone !== user.phone) {
      user.isPhoneVerified = false;
    }

    for (const field of UsersService.SELF_EDITABLE_PROFILE_FIELDS) {
      const value = (updateProfileDto as Record<string, unknown>)[field];
      if (value !== undefined) {
        (user as unknown as Record<string, unknown>)[field] = value;
      }
    }

    await this.userCacheService.clearUserSession(id);
    return this.userRepository.save(user);
  }

  // NOTE: the secure two-step email-change flow (requestEmailChange + confirmEmailChange)
  // is defined further below. The previous single-step variant was removed in favour of it.

  async findAllByOrg(
    organizationId: string,
    options: {
      page: number;
      pageSize: number;
      searchTerm?: string;
      statusFilter?: string;
      sortColumn?: string;
      sortDirection?: 'ASC' | 'DESC';
    },
  ): Promise<{ data: User[]; total: number }> {
    const {
      page,
      pageSize,
      searchTerm,
      statusFilter,
      sortColumn,
      sortDirection,
    } = options;

    // Membership, not the single `users.organization_id` column.
    //
    // Every administration query in this service filtered by that column, while authentication
    // resolved access from `user_organizations`. The two disagreed for exactly the case the
    // multi-tenancy exists to serve: an accountant invited by a second customer keeps their
    // original `organization_id`, so for that second tenant they were invisible — absent from the
    // user list, un-editable, un-blockable — while holding a live role there and working in the
    // data. The service's own comment calls that "the normal case, not an edge one".
    //
    // Roles are additionally filtered to the tenant being administered, so a user's role in
    // ANOTHER organization is never displayed or acted on here.
    const queryBuilder = this.userRepository.createQueryBuilder('user');

    queryBuilder
      .innerJoin(
        UserOrganization,
        'membership',
        'membership.user_id = user.id AND membership.organization_id = :organizationId',
        { organizationId },
      )
      .leftJoinAndSelect(
        'user.roles',
        'role',
        'role.organizationId = :organizationId OR role.organizationId IS NULL',
        { organizationId },
      )
      .skip((page - 1) * pageSize)
      .take(pageSize);

    if (searchTerm) {
      queryBuilder.andWhere(
        '(user.firstName ILIKE :searchTerm OR user.lastName ILIKE :searchTerm OR user.email ILIKE :searchTerm)',
        { searchTerm: `%${searchTerm}%` },
      );
    }

    if (statusFilter && statusFilter !== 'all') {
      queryBuilder.andWhere('user.status = :status', {
        status: statusFilter,
      });
    }

    if (sortColumn && sortDirection) {
      const allowedColumns = [
        'firstName',
        'lastName',
        'email',
        'status',
        'createdAt',
      ];
      if (allowedColumns.includes(sortColumn)) {
        queryBuilder.orderBy(`user.${sortColumn}`, sortDirection);
      }
    } else {
      queryBuilder.orderBy('user.createdAt', 'DESC');
    }

    const [data, total] = await queryBuilder.getManyAndCount();

    return { data, total };
  }

  async updateUser(
    id: string,
    updateUserDto: UpdateUserDto,
    organizationId: string,
    actor: AuthenticatedUser,
  ): Promise<User> {
    const user = await this.findMemberWithSecurity(id, organizationId);

    const { roleId, ...userData } = updateUserDto;

    Object.assign(user, userData);

    if (roleId) {
      const role = await this.rolesService.findOne(roleId, organizationId);
      if (!role) {
        throw new NotFoundException(`Rol con ID ${roleId} no encontrado.`);
      }
      // H-01 FIX: Validate the actor is actually allowed to grant this role. Without this,
      // a non-admin holding only `users:edit` could assign the ADMINISTRATOR role ('*') to
      // any user (including themselves) — a vertical privilege escalation.
      this.rolesService.assertCanAssignRole(actor, role);

      // Changing the role can strip administrative standing; make sure someone is left holding it.
      const wasAdministrator = UsersService.isAdministrator(user);
      const willBeAdministrator = UsersService.isAdministrator({ roles: [role] });
      if (wasAdministrator && !willBeAdministrator) {
        await this.assertOrganizationRetainsAdministrator(organizationId, id);
      }

      user.roles = [role];
      // Increment token version to invalidate sessions on role change
      if (user.security) {
          user.security.tokenVersion = (user.security.tokenVersion || 0) + 1;
      }
      await this.userCacheService.clearUserSession(id);
    } else {
      await this.userCacheService.clearUserSession(id);
    }

    return this.userRepository.save(user);
  }

  /**
   * Permissions that together constitute administrative control of an organization: the ability
   * to manage members and to rewrite the authorization graph.
   */
  private static readonly ADMIN_CAPABILITIES = ['users:edit', 'roles:edit'];

  private static isAdministrator(user: Pick<User, 'roles'>): boolean {
    const permissions = [...new Set((user.roles ?? []).flatMap((role) => role.permissions ?? []))];
    return UsersService.ADMIN_CAPABILITIES.every((capability) =>
      hasPermission(permissions, [capability]),
    );
  }

  /**
   * Refuse any change that would leave an organization with no administrator.
   *
   * Nothing prevented this before: the last administrator could be deleted, blocked, or demoted
   * to a role without `roles:edit`, at which point *no one* could create roles, invite members,
   * or restore access — the tenant is bricked and only a manual database edit recovers it.
   * Deleting your own account or blocking yourself achieved the same thing in one click.
   *
   * @param excludeUserId the user about to lose administrative standing
   */
  private async assertOrganizationRetainsAdministrator(
    organizationId: string,
    excludeUserId: string,
  ): Promise<void> {
    // Candidates are the tenant's MEMBERS, and only their roles IN this tenant count. Reading
    // `users.organization_id` missed every administrator who had joined by invitation from
    // another tenant, so the "last administrator" guard could refuse a legitimate change — or,
    // worse, let the real last administrator be demoted because someone else's role in a
    // different organization looked like administrative standing here.
    const candidates = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin(
        UserOrganization,
        'membership',
        'membership.user_id = user.id AND membership.organization_id = :organizationId',
        { organizationId },
      )
      .leftJoinAndSelect(
        'user.roles',
        'roles',
        'roles.organizationId = :organizationId OR roles.organizationId IS NULL',
        { organizationId },
      )
      .where('user.status = :status', { status: UserStatus.ACTIVE })
      .getMany();

    const remainingAdmins = candidates.filter(
      (candidate) => candidate.id !== excludeUserId && UsersService.isAdministrator(candidate),
    );

    if (remainingAdmins.length === 0) {
      throw new ForbiddenException(
        'Esta acción dejaría a la organización sin ningún administrador activo. ' +
          'Asigna el rol de administrador a otro usuario antes de continuar.',
      );
    }
  }

  /**
   * Remove somebody from a tenant.
   *
   * Not "delete the user". One person has one identity across the whole platform — `users.email`
   * is globally unique and a password and MFA factors belong to a human being, not to each
   * customer they work with — so deleting the row on behalf of one tenant would destroy that
   * person's access to every other tenant they belong to. That is what this did.
   *
   * What actually happens: the membership is revoked, the roles they held IN THIS TENANT are
   * dropped, and the identity itself is deleted only when this was their last membership, i.e.
   * when nothing else on the platform refers to them any more.
   *
   * There was also no way to do this at all: `MembershipService.revoke` existed and was called
   * from nowhere, so a tenant could add people and never remove them.
   */
  async remove(id: string, organizationId: string, actorId?: string): Promise<void> {
    const user = await this.findMemberWithSecurity(id, organizationId);

    if (actorId && actorId === id) {
      throw new ForbiddenException(
        'No puedes eliminar tu propia cuenta desde la administración de usuarios.',
      );
    }

    const isSystemUser = (user.roles ?? []).some((role) => role.isSystemRole);
    if (isSystemUser) {
      throw new ForbiddenException(
        'No se puede eliminar un usuario con un rol de sistema.',
      );
    }

    if (UsersService.isAdministrator(user)) {
      await this.assertOrganizationRetainsAdministrator(organizationId, id);
    }

    await this.dataSource.transaction(async (manager) => {
      await this.membershipService.revoke(id, organizationId, manager);

      // Drop only the roles scoped to this tenant. A platform role (null organization) and roles
      // held in other tenants are none of this tenant's business. Reloaded inside the transaction
      // because `user.roles` was filtered to this organization by the lookup above.
      const fresh = await manager.findOne(User, { where: { id }, relations: ['roles'] });
      if (fresh) {
        fresh.roles = (fresh.roles ?? []).filter((role) => role.organizationId !== organizationId);
        await manager.save(User, fresh);
      }

      // The seat goes back to the tenant. `USERS` is a LIFETIME quota, so without this a tenant
      // that removed somebody could never replace them: the counter measured hires, not staff.
      await this.saasService.releaseUsage(manager, organizationId, SaasResource.USERS);

      const stillBelongsSomewhere = await manager.count(UserOrganization, { where: { userId: id } });
      if (stillBelongsSomewhere === 0) {
        // Nothing else refers to this person; the identity itself goes.
        await manager.delete(User, { id });
      } else if (fresh?.organizationId === organizationId) {
        // Their "home" tenant was the one they just left. Point it at one they still belong to,
        // otherwise `resolveOrganizationContext` rejects every request they make: it requires a
        // linked organization and would find one they can no longer access.
        const next = await manager.findOne(UserOrganization, { where: { userId: id } });
        if (next) {
          await manager.update(User, { id }, { organizationId: next.organizationId });
        }
      }
    });

    await this.userCacheService.clearUserSession(id);
    // Their sessions carry a tenant and a permission set that no longer apply. Ending them is
    // what makes the revocation take effect now rather than at cache expiry.
    await this.sessionService.terminateAllSessions(id);
  }

  /**
   * A user, with no roles and no tenant context.
   *
   * For callers that need the identity itself — a first name for an email, an address for an
   * OTP — and have no business loading an authorization graph to get it.
   */
  async findBasicById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  /**
   * One user, with the roles and permissions they hold IN ONE TENANT.
   *
   * `organizationId` is required, and that is the fix. This method backs `GET /users/profile`
   * and loaded `relations: ['roles']` with no filter, then flattened `permissions` across every
   * role the person held anywhere — so an accountant working for two customers received, in
   * their own profile, the roles and permission names they hold at the OTHER customer. That
   * discloses both the existence of the commercial relationship and the level of access, and it
   * contradicts the scoping `UserIdentityService.permissionsFor` and `TokenService.buildSafeUser`
   * already apply on every other path.
   *
   * A role with a null `organization_id` is a platform role and applies everywhere by design.
   */
  async findOne(id: string, organizationId: string): Promise<User> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect(
        'user.roles',
        'role',
        'role.organizationId = :organizationId OR role.organizationId IS NULL',
        { organizationId },
      )
      .where('user.id = :id', { id })
      .getOne();

    if (!user) {
      throw new NotFoundException(`Usuario con id ${id} no encontrado`);
    }

    // The organization shown is the one the request is acting in, not the user's home tenant.
    user.organization = (await this.orgRepository.findOneBy({ id: organizationId })) ?? undefined;
    user.permissions = [...new Set((user.roles ?? []).flatMap((role) => role.permissions ?? []))];

    return user;
  }

  /**
   * A user this tenant may administer, resolved by MEMBERSHIP.
   *
   * The single source of "does this tenant have authority over this user". Every mutating
   * administration method goes through it, so the tenant check exists in one place rather than as
   * a `where: { id, organizationId }` repeated at eight call sites — which is how it came to mean
   * something different from what authentication meant by the same question.
   */
  async findOneByOrg(id: string, organizationId: string): Promise<User> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin(
        UserOrganization,
        'membership',
        'membership.user_id = user.id AND membership.organization_id = :organizationId',
        { organizationId },
      )
      // Roles for THIS tenant. Without the join `GET /users/:id` returned a user whose `roles`
      // and `permissions` were always empty — the DTO substitutes `[]` for a missing relation —
      // so the detail screen could never show what a member is actually allowed to do. Scoped
      // like everywhere else, so a role held at another customer is neither shown nor acted on.
      .leftJoinAndSelect(
        'user.roles',
        'role',
        'role.organizationId = :organizationId OR role.organizationId IS NULL',
        { organizationId },
      )
      .where('user.id = :id', { id })
      .getOne();

    if (!user) {
      throw new NotFoundException(`Usuario con id ${id} no encontrado en tu organización`);
    }
    user.permissions = [...new Set((user.roles ?? []).flatMap((role) => role.permissions ?? []))];
    return user;
  }

  /** Same check, with the relations the mutating paths need. */
  private async findMemberWithSecurity(id: string, organizationId: string): Promise<User> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin(
        UserOrganization,
        'membership',
        'membership.user_id = user.id AND membership.organization_id = :organizationId',
        { organizationId },
      )
      .leftJoinAndSelect('user.security', 'security')
      .leftJoinAndSelect(
        'user.roles',
        'roles',
        'roles.organizationId = :organizationId OR roles.organizationId IS NULL',
        { organizationId },
      )
      .where('user.id = :id', { id })
      .getOne();

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado en tu organización.`);
    }
    return user;
  }

  async findOneByEmail(email: string): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: { email },
    });

    return user;
  }

  async updateUserStatus(
    id: string,
    status: UserStatus,
    organizationId: string,
    actorId?: string,
  ): Promise<User> {
    const user = await this.findMemberWithSecurity(id, organizationId);

    if (actorId && actorId === id && status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('No puedes desactivar o bloquear tu propia cuenta.');
    }

    // Losing ACTIVE means losing administrative standing.
    if (status !== UserStatus.ACTIVE && UsersService.isAdministrator(user)) {
      await this.assertOrganizationRetainsAdministrator(organizationId, id);
    }

    user.status = status;
    // Invalidate sessions on status change (e.g., blocking)
    if (user.security) {
        user.security.tokenVersion = (user.security.tokenVersion || 0) + 1;
    }
    await this.userCacheService.clearUserSession(id);
    return this.userRepository.save(user);
  }

  async resetPassword(id: string, organizationId: string): Promise<void> {
    const user = await this.findMemberWithSecurity(id, organizationId);

    // Ensure security entity exists (it should, but for safety)
    if (!user.security) {
        user.security = new UserSecurity();
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    user.security.passwordResetToken = tokenHash;
    user.security.passwordResetExpires = new Date(Date.now() + 3600000);

    await this.userRepository.save(user);
    await this.userCacheService.clearUserSession(id);

    try {
      await this.mailService.sendPasswordResetEmail(user, rawToken, '1h');
    } catch (error) {
      // H14 FIX: Do not log email in plain. Use structured logging without PII.
      this.logger.error(
        { event: 'password_reset_email_not_queued', userId: user.id },
        `Failed to queue the password reset email: ${(error as Error).message}`,
      );

      // The token stays. It used to be cleared here, which made sense when the send was a direct
      // SMTP call that had definitively failed; now delivery is a queued job with retries, so
      // destroying the token would invalidate a link the queue is still going to deliver. What
      // reaches this branch is a queue outage, and the administrator can simply try again.
      throw new Error(
        'No se pudo encolar el correo de restablecimiento. Inténtalo de nuevo en unos minutos.',
      );
    }
  }

  // -----------------------------------------------------------------------
  // H-01 FIX: Secure email-change flow
  // Requires step-up (current password) + confirmation token sent to new address.
  // The live email is never updated until the user clicks the link.
  // Sessions are invalidated after the switch so stolen tokens cannot persist.
  // (OWASP ASVS V2/V3; OWASP Forgot Password Cheat Sheet; CWE-620/CWE-287)
  // -----------------------------------------------------------------------

  /**
   * Begin an email change. The new address is not applied until its owner clicks the link.
   *
   * @param alreadyReauthenticated  the caller has already proved identity through StepUpGuard,
   *   so no password is demanded here. Passed explicitly by the controller.
   *
   * This used to be expressed as `if (dto.currentPassword !== 'STEP_UP_VERIFIED')` — a literal
   * sentinel inside the field that carries the secret. Guarded by StepUpGuard it was not
   * exploitable over HTTP, but it is a backdoor by construction: any internal caller, or any
   * future route that reaches this service without the guard, skips the password check by sending
   * one magic string. Whether re-authentication has happened is a fact about the CALL, so it is
   * now a parameter of the call.
   */
  async requestEmailChange(
    userId: string,
    dto: RequestEmailChangeDto,
    alreadyReauthenticated = false,
  ): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['security'],
    });
    if (!user || !user.security) throw new UnauthorizedException();

    if (!alreadyReauthenticated) {
        if (!user.security.passwordHash) throw new UnauthorizedException();
        const passwordValid = await this.passwordService.verify(user.security.passwordHash, dto.currentPassword);
        if (!passwordValid) throw new UnauthorizedException('Credenciales incorrectas.');
    }

    const conflict = await this.userRepository.findOne({ where: { email: dto.newEmail } });
    if (conflict) {
      // Return generic message to avoid leaking email enumeration
      throw new BadRequestException('No se pudo completar el cambio de correo electrónico.');
    }

    const raw = crypto.randomBytes(32).toString('hex');
    user.security.emailChangeToken = crypto.createHash('sha256').update(raw).digest('hex');
    user.security.emailChangeTarget = dto.newEmail;
    user.security.emailChangeExpires = new Date(Date.now() + 15 * 60_000); // 15 min TTL
    await this.userRepository.save(user);

    await this.mailService.sendEmailChangeConfirmation(dto.newEmail, raw, user.firstName);
  }

  async confirmEmailChange(userId: string, dto: ConfirmEmailChangeDto): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['security'],
    });

    if (
      !user?.security?.emailChangeToken ||
      !user.security.emailChangeTarget ||
      !user.security.emailChangeExpires
    ) {
      throw new BadRequestException('No hay ningún cambio de correo pendiente.');
    }

    if (user.security.emailChangeExpires < new Date()) {
      throw new BadRequestException('El enlace de confirmación ha expirado. Solicita uno nuevo.');
    }

    const tokenHash = crypto.createHash('sha256').update(dto.token).digest('hex');
    const stored = Buffer.from(user.security.emailChangeToken);
    const supplied = Buffer.from(tokenHash);
    if (stored.length !== supplied.length || !crypto.timingSafeEqual(stored, supplied)) {
      throw new BadRequestException('Token de confirmación inválido.');
    }

    const previousEmail = user.email;

    user.email = user.security.emailChangeTarget;
    user.isEmailVerified = true;
    user.security.emailChangeToken = null;
    user.security.emailChangeTarget = null;
    user.security.emailChangeExpires = null;
    user.security.tokenVersion = (user.security.tokenVersion || 0) + 1;

    await this.userRepository.save(user);
    await this.userCacheService.clearUserSession(userId);

    // Tell the address that is LOSING the account.
    //
    // Only the new address was ever notified, which is the wrong way round for the case that
    // matters: a hijacked session changing the email silently redirects password recovery and
    // locks the real owner out with no signal at all. The old address is the only channel the
    // attacker does not control by then. Delivery failure must not roll back a change the user
    // legitimately confirmed, so it is logged rather than thrown.
    try {
      await this.mailService.sendEmailChangedNotice(previousEmail, user.firstName, user.email);
    } catch (error) {
      this.logger.error(
        { event: 'email_change_notice_failed', userId },
        `Could not notify the previous address of an email change: ${(error as Error).message}`,
      );
    }
  }

  /**
   * What this user has done, from the audit trail.
   *
   * This returned `[]` unconditionally. The endpoint was published, permission-gated and
   * commented about IDOR prevention, and the screen behind it always rendered empty — while
   * `AuditTrailService` had been recording these very actions all along. The tenant check stays:
   * it is what stops a privileged user reading another tenant's activity through a cross-org id.
   */
  async getActivityLog(userId: string, organizationId: string): Promise<UserActivityEntry[]> {
    await this.findOneByOrg(userId, organizationId);

    const entries = await this.auditTrailService.findByActor(userId, organizationId);

    return entries.map((entry) => ({
      id: entry.id,
      action: entry.actionType,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      at: entry.timestamp,
      ipAddress: entry.ipAddress ?? null,
      details: (entry.newValue as Record<string, unknown> | null) ?? null,
    }));
  }

  /**
   * Invite somebody to a tenant.
   *
   * Two cases, and only one of them used to work.
   *
   * A person with no account anywhere gets one, plus a membership and the assigned role. That is
   * what the previous implementation did.
   *
   * A person who already has an account — at ANY tenant on the platform — is added to this one:
   * a membership row and a role in this organization, against their existing identity. Previously
   * this created a second `users` row, and `users.email` carries a global unique constraint, so
   * the insert failed with `duplicate key value violates unique constraint
   * "UQ_97672ac88f789774dd47f7c8be3"` — a 500 with a database error in it. The pre-check could
   * never catch it, because it looked up `{ email, organizationId }` and the conflicting row
   * belongs to a different organization. For a product sold to many tenants in one region, an
   * accountant working with two clients is the normal case, not an edge one.
   *
   * One identity per person is also what credentials require: a password, a TOTP secret and a set
   * of backup codes belong to a human being, not to each customer they work with.
   */
  async inviteUser(
    inviteUserDto: InviteUserDto,
    organizationId: string,
    actor: AuthenticatedUser,
  ): Promise<User> {
    const { email, firstName, lastName, roleId } = inviteUserDto;

    const role = await this.rolesService.findOne(roleId, organizationId);
    if (!role) {
      this.logger.warn(`Invite role not found: org=${organizationId} roleId=${roleId}`);
      throw new BadRequestException('No se pudo enviar la invitación con los datos proporcionados.');
    }

    // An invitation grants a role, so it is a privilege delegation and carries the same limit
    // `updateUser` applies: nobody may hand out rights they do not hold themselves.
    //
    // This check was missing here and in `addExistingUserToOrganization`, which were the only
    // other two places a role is assigned. An operator holding just `users:create` could invite
    // an address they control as ADMINISTRATOR — a role carrying '*' — and take over the tenant.
    // The MANAGE_USERS step-up in front of the route does not help: it proves who the caller is,
    // not what they are entitled to give away.
    this.rolesService.assertCanAssignRole(actor, role);

    // Platform-wide, not organization-scoped. The unique constraint is platform-wide, so a
    // lookup that is not tells you nothing about whether the insert can succeed.
    const existingUser = await this.userRepository.findOne({
      where: { email },
      relations: ['roles'],
    });

    if (existingUser) {
      return this.addExistingUserToOrganization(existingUser, organizationId, role);
    }

    // M-03 FIX: Persist only a SHA-256 hash of the invitation token (same approach as the
    // password-reset token). The raw token travels by email; a DB leak no longer allows
    // activating/taking over PENDING accounts.
    const rawInvitationToken = crypto.randomBytes(32).toString('base64url');
    const invitationTokenHash = crypto.createHash('sha256').update(rawInvitationToken).digest('hex');
    const tokenExpires = new Date();
    tokenExpires.setDate(tokenExpires.getDate() + 7);

    const newUser = this.userRepository.create({
      firstName,
      lastName,
      email,
      organizationId,
      roles: [role],
      status: UserStatus.PENDING,
      invitationToken: invitationTokenHash,
      invitationTokenExpires: tokenExpires,
      security: new UserSecurity() // Initialize security
    });

    const created = await this.dataSource.transaction(async (manager) => {
        await this.saasService.enforceLimit(manager, organizationId, SaasResource.USERS);

        await manager.save(newUser);

        // The membership is written INSIDE the transaction. Written outside, it would survive a
        // rollback and grant access to a tenant for a user that was never created.
        await this.membershipService.grant(newUser.id, organizationId, manager);

        return newUser;
    });

    // Queued AFTER the transaction commits, and deliberately so.
    //
    // The invitation used to be sent inside it, which had the failure modes back to front: an
    // unreachable SMTP server rolled back a user that had been created correctly, while an email
    // queued before a later rollback would have invited somebody to an account that does not
    // exist. Committing first and queueing after is the only order where neither happens.
    //
    // A queue failure is logged rather than thrown: the member exists and can be re-invited, and
    // failing the request after a successful commit would tell the administrator the opposite of
    // what happened.
    try {
      await this.mailService.sendUserInvitation(created, rawInvitationToken);
    } catch (error) {
      this.logger.error(
        { event: 'invitation_email_not_queued', userId: created.id },
        `User created but the invitation could not be queued: ${(error as Error).message}`,
      );
    }

    delete created.invitationToken;
    delete created.invitationTokenExpires;

    return created;
  }

  /**
   * Add somebody who already has an account to another tenant.
   *
   * They keep their identity, their password and their MFA factors; they gain a membership and a
   * role scoped to this organization. Because roles carry `organization_id` and permissions are
   * now resolved per active tenant, holding a role here says nothing about their rights anywhere
   * else.
   *
   * Re-inviting somebody who is already a member is not an error and not a way to probe: the same
   * generic response is returned either way, so the endpoint cannot be used to ask "does this
   * person have an account with you".
   */
  private async addExistingUserToOrganization(
    user: User,
    organizationId: string,
    role: Role,
  ): Promise<User> {
    // The caller (`inviteUser`) has already run `assertCanAssignRole` for this role, before
    // branching on whether the person already has an account — so both halves of the invitation
    // are covered by one check. Any future caller of this method must do the same.
    const alreadyMember = await this.membershipService.isMember(user.id, organizationId);
    const alreadyHasRoleHere = (user.roles ?? []).some(
      (existing) => existing.organizationId === organizationId,
    );

    if (alreadyMember && alreadyHasRoleHere) {
      this.logger.log(
        { event: 'invite_existing_member', organizationId, userId: user.id },
        'Invitation for a user who is already a member of this organization; no change made.',
      );
      return user;
    }

    return this.dataSource.transaction(async (manager) => {
      await this.saasService.enforceLimit(manager, organizationId, SaasResource.USERS);

      await this.membershipService.grant(user.id, organizationId, manager);

      if (!alreadyHasRoleHere) {
        user.roles = [...(user.roles ?? []), role];
        await manager.save(User, user);
      }

      // Their existing sessions carry a permission set computed before this role existed.
      await this.userCacheService.clearUserSession(user.id);

      const organization = await manager.findOne(Organization, { where: { id: organizationId } });
      await this.mailService.sendAddedToOrganizationEmail(
        user,
        organization?.legalName ?? 'una organización',
      );

      return user;
    });
  }

  async adminChangeEmail(userId: string, newEmail: string, organizationId: string): Promise<void> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!newEmail || !emailRegex.test(newEmail)) {
      throw new BadRequestException('Formato de email inválido.');
    }

    const user = await this.findMemberWithSecurity(userId, organizationId);

    const existing = await this.userRepository.findOne({ where: { email: newEmail } });
    if (existing && existing.id !== userId) {
      throw new BadRequestException('El email ya está en uso por otro usuario.');
    }

    const oldEmail = user.email;
    user.email = newEmail;
    user.isEmailVerified = false;

    if (user.security) {
      user.security.tokenVersion = (user.security.tokenVersion || 0) + 1;
    }

    await this.userRepository.save(user);
    await this.userCacheService.clearUserSession(userId);

    this.eventEmitter.emit('user.admin.email-changed', { userId, oldEmail, newEmail, organizationId });
  }

  // H-11: org is required so force-logout is always tenant-scoped (no IDOR).
  async forceLogout(userId: string, organizationId: string): Promise<{ message: string }> {
    const user = await this.findMemberWithSecurity(userId, organizationId);

    if (user.security) {
        user.security.tokenVersion += 1;
        await this.userRepository.save(user);
    }
    await this.userCacheService.clearUserSession(userId);

    this.eventEmitter.emit('user.force-logout', {
      userId,
      reason: 'Su sesión ha sido cerrada por un administrador.',
    });

    return { message: 'Se ha cerrado la sesión del usuario.' };
  }

  async blockAndLogout(userId: string, organizationId: string): Promise<{ message: string }> {
    const user = await this.findMemberWithSecurity(userId, organizationId);

    user.status = UserStatus.BLOCKED;
    if (user.security) {
        user.security.tokenVersion += 1;
    }
    await this.userRepository.save(user);
    await this.userCacheService.clearUserSession(userId);

    this.eventEmitter.emit('user.force-logout', {
      userId,
      reason:
        'Su cuenta ha sido bloqueada y su sesión ha sido cerrada por un administrador.',
    });

    return { message: 'Se ha bloqueado y cerrado la sesión del usuario.' };
  }
  
  async setOnlineStatus(userId: string, isOnline: boolean): Promise<User> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    user.isOnline = isOnline;
    const updatedUser = await this.userRepository.save(user);
    this.eventEmitter.emit('user.status.changed', { userId, isOnline });
    return updatedUser;
  }

  // --- Auth Abstraction Methods ---

  async findUserForAuth(email: string): Promise<User | null> {
    const user = await this.userRepository.findOne({
        where: { email },
        relations: ['roles', 'security'],
    });
    if (!user) return null;
    user.organization = user.organizationId
      ? ((await this.orgRepository.findOneBy({ id: user.organizationId })) ?? undefined)
      : undefined;
    return user;
  }

  async findUserByIdForAuth(id: string): Promise<User | null> {
    const user = await this.userRepository.createQueryBuilder('user')
      .where('user.id = :id', { id })
      .leftJoinAndSelect('user.roles', 'roles')
      .leftJoinAndSelect('user.security', 'security')
      .getOne();

    if (!user) return null;

    user.organization = user.organizationId
      ? (await this.orgRepository.findOneBy({ id: user.organizationId })) ?? undefined
      : undefined;

    // Multi-tenant enrichment: every organization the user can act in.
    user.organizations = await this.findAccessibleOrganizations(id, user.organization);

    return user;
  }

  /**
   * The organizations a user may act in.
   *
   * This was a raw SQL join written inline here, wrapped in a try/catch that fell back to the
   * active organization on any error — which meant a broken query degraded silently into
   * single-tenant behaviour and nobody found out. The membership table now has an owner
   * (`MembershipService`), one that writes it as well as reads it, and a failure is a failure.
   */
  private async findAccessibleOrganizations(
    userId: string,
    activeOrg?: Organization,
  ): Promise<Array<{ id: string; legalName: string }>> {
    const memberships = await this.membershipService.listFor(userId, activeOrg?.id ?? null);
    return memberships.map(({ id, legalName }) => ({ id, legalName }));
  }

  async save(user: User): Promise<User> {
    return this.userRepository.save(user);
  }

  async update(id: string, partialEntity: any): Promise<void> {
    // SECURITY 10/10: Prevent generic updates to sensitive security fields.
    // Explicit methods (e.g., changePassword, updateProfile, enable2fa) must be used instead.
    const securityKeys = [
        'passwordHash', 'tokenVersion', 'failedLoginAttempts', 'lockoutUntil',
        'passwordResetToken', 'passwordResetExpires', 'isTwoFactorEnabled', 'twoFactorSecret'
    ];

    const hasSecurityKeys = Object.keys(partialEntity).some(k => securityKeys.includes(k));

    if (hasSecurityKeys) {
        throw new Error('Security fields cannot be updated via generic update method. Use specific service methods.');
    }

    await this.userRepository.update(id, partialEntity);
  }
}
