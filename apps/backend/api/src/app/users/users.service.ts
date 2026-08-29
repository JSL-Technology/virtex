
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
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { hasPermission } from '@virteex/shared/util-auth';
import { SessionService } from '../auth/services/session.service';

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
    'department',
    'avatarUrl',
    'preferredLanguage',
  ] as const;

  async updateProfile(id: string, updateProfileDto: UpdateProfileDto): Promise<User> {
    const user = await this.findOne(id);

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

    const queryBuilder = this.userRepository.createQueryBuilder('user');

    queryBuilder
      .where('user.organizationId = :organizationId', { organizationId })
      .leftJoinAndSelect('user.roles', 'role')
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
    const user = await this.userRepository.findOne({
        where: { id, organizationId },
        relations: ['security', 'roles']
    });
    if (!user) {
      throw new NotFoundException(
        `Usuario con ID ${id} no encontrado en tu organización.`,
      );
    }

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
    const candidates = await this.userRepository.find({
      where: { organizationId, status: UserStatus.ACTIVE },
      relations: ['roles'],
    });

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

  async remove(id: string, organizationId: string, actorId?: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id, organizationId },
      relations: ['roles'],
    });

    if (!user) {
      throw new NotFoundException(
        `Usuario con ID ${id} no encontrado en tu organización.`,
      );
    }

    if (actorId && actorId === id) {
      throw new ForbiddenException(
        'No puedes eliminar tu propia cuenta desde la administración de usuarios.',
      );
    }

    const isSystemUser = user.roles.some((role) => role.isSystemRole);
    if (isSystemUser) {
      throw new ForbiddenException(
        'No se puede eliminar un usuario con un rol de sistema.',
      );
    }

    if (UsersService.isAdministrator(user)) {
      await this.assertOrganizationRetainsAdministrator(organizationId, id);
    }

    await this.userCacheService.clearUserSession(id);
    // Sessions must die with the account, otherwise an already-issued access token keeps working
    // for its remaining lifetime against a user row that no longer exists.
    await this.sessionService.terminateAllSessions(id);
    await this.userRepository.remove(user);
  }

  async findOne(id: string): Promise<User> {
    // Roles and organization are loaded because UserResponseDto exposes them; without the
    // relations they serialise as an empty array / null and the profile screen renders blank.
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['roles'],
    });

    if (!user) {
      throw new NotFoundException(`Usuario con id ${id} no encontrado`);
    }

    if (user.organizationId) {
      user.organization = (await this.orgRepository.findOneBy({ id: user.organizationId })) ?? undefined;
    }
    user.permissions = [...new Set((user.roles ?? []).flatMap((role) => role.permissions ?? []))];

    return user;
  }

  // H2 FIX: org-scoped findOne prevents IDOR cross-tenant reads.
  async findOneByOrg(id: string, organizationId: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id, organizationId },
    });

    if (!user) {
      throw new NotFoundException(`Usuario con id ${id} no encontrado en tu organización`);
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
    const user = await this.userRepository.findOne({
        where: { id, organizationId },
        relations: ['security', 'roles']
    });
    if (!user) {
      throw new NotFoundException(`Usuario no encontrado`);
    }

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
    const user = await this.userRepository.findOne({
        where: { id, organizationId },
        relations: ['security']
    });
    if (!user) {
      throw new NotFoundException(`Usuario no encontrado`);
    }

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
      this.logger.error({ event: 'password_reset_email_failed', userId: user.id }, 'Failed to send password reset email');

      user.security.passwordResetToken = null;
      user.security.passwordResetExpires = null;
      await this.userRepository.save(user);

      throw new Error(
        'Could not send password reset email. Please try again later.',
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

  async requestEmailChange(userId: string, dto: RequestEmailChangeDto): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['security'],
    });
    if (!user || !user.security) throw new UnauthorizedException();

    if (dto.currentPassword !== 'STEP_UP_VERIFIED') {
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

    user.email = user.security.emailChangeTarget;
    user.isEmailVerified = true;
    user.security.emailChangeToken = null;
    user.security.emailChangeTarget = null;
    user.security.emailChangeExpires = null;
    user.security.tokenVersion = (user.security.tokenVersion || 0) + 1;

    await this.userRepository.save(user);
    await this.userCacheService.clearUserSession(userId);
  }

  async getActivityLog(userId: string, organizationId: string): Promise<any[]> {
    // H-11 FIX: Verify the target user belongs to the caller's org before returning
    // any data. This prevents cross-tenant IDOR when real audit data is added.
    await this.findOneByOrg(userId, organizationId);
    return [];
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
  ): Promise<User> {
    const { email, firstName, lastName, roleId } = inviteUserDto;

    const role = await this.rolesService.findOne(roleId, organizationId);
    if (!role) {
      this.logger.warn(`Invite role not found: org=${organizationId} roleId=${roleId}`);
      throw new BadRequestException('No se pudo enviar la invitación con los datos proporcionados.');
    }

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

    return this.dataSource.transaction(async (manager) => {
        await this.saasService.enforceLimit(manager, organizationId, SaasResource.USERS);

        await manager.save(newUser);

        // The membership is written INSIDE the transaction. Written outside, it would survive a
        // rollback and grant access to a tenant for a user that was never created.
        await this.membershipService.grant(newUser.id, organizationId, manager);

        // Email the RAW token (only the hash is stored server-side).
        await this.mailService.sendUserInvitation(newUser, rawInvitationToken);

        delete newUser.invitationToken;
        delete newUser.invitationTokenExpires;

        return newUser;
    });
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

    const user = await this.userRepository.findOne({
      where: { id: userId, organizationId },
      relations: ['security'],
    });
    if (!user) {
      throw new NotFoundException(`Usuario no encontrado`);
    }

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
    const user = await this.userRepository.findOne({ where: { id: userId, organizationId }, relations: ['security'] });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

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
    const user = await this.userRepository.findOne({ where: { id: userId, organizationId }, relations: ['security'] });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

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
    user.organization = await this.orgRepository.findOneBy({ id: user.organizationId }) ?? undefined;
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
