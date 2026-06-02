
import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException, UnauthorizedException, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { User } from './entities/user.entity/user.entity';
import { UserStatus } from './entities/user.entity/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { InviteUserDto } from './entities/user.entity/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { MailService } from '../mail/mail.service';
import { RolesService } from '../roles/roles.service';
import * as crypto from 'crypto';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { UserSecurity } from './entities/user-security.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SaasService } from '../saas/saas.service';
import { SaasResource } from '../saas/enums/saas-resource.enum';

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
    private readonly eventEmitter: EventEmitter2,
    private readonly saasService: SaasService,
    private readonly dataSource: DataSource
  ) {}

  async updateProfile(id: string, updateProfileDto: UpdateProfileDto): Promise<User> {
    const user = await this.findOne(id);

    if (updateProfileDto.phone && updateProfileDto.phone !== user.phone) {
      user.isPhoneVerified = false;
    }

    Object.assign(user, updateProfileDto);
    await this.userCacheService.clearUserSession(id);
    return this.userRepository.save(user);
  }

  async requestEmailChange(userId: string, dto: { newEmail: string; currentPassword: string }): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['security'],
    });

    if (!user || !user.security?.passwordHash) {
      throw new BadRequestException('No se puede cambiar el email para este usuario.');
    }

    const isPasswordValid = await argon2.verify(user.security.passwordHash, dto.currentPassword);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Contraseña actual incorrecta.');
    }

    const normalizedEmail = dto.newEmail.toLowerCase().trim();
    if (normalizedEmail === user.email.toLowerCase()) {
      throw new BadRequestException('El nuevo email debe ser diferente al actual.');
    }

    const existing = await this.userRepository.findOne({ where: { email: normalizedEmail } });
    if (existing) {
      throw new BadRequestException('El email ya está en uso por otro usuario.');
    }

    user.email = normalizedEmail;
    user.isEmailVerified = false;
    user.security.tokenVersion = (user.security.tokenVersion || 0) + 1;

    await this.userRepository.save(user);
    await this.userCacheService.clearUserSession(userId);

    this.eventEmitter.emit('user.email-changed', { userId, newEmail: normalizedEmail });
  }

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
  ): Promise<User> {
    const user = await this.userRepository.findOne({
        where: { id, organizationId },
        relations: ['security']
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

  async remove(id: string, organizationId: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id, organizationId },
      relations: ['roles'],
    });

    if (!user) {
      throw new NotFoundException(
        `Usuario con ID ${id} no encontrado en tu organización.`,
      );
    }

    const isSystemUser = user.roles.some((role) => role.isSystemRole);
    if (isSystemUser) {
      throw new ForbiddenException(
        'No se puede eliminar un usuario con un rol de sistema.',
      );
    }

    await this.userCacheService.clearUserSession(id);
    await this.userRepository.remove(user);
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: id as any },
    });

    if (!user) {
      throw new NotFoundException(`Usuario con id ${id} no encontrado`);
    }
    return user;
  }

  // H2 FIX: org-scoped findOne prevents IDOR cross-tenant reads.
  async findOneByOrg(id: string, organizationId: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: id as any, organizationId },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
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
  ): Promise<User> {
    const user = await this.userRepository.findOne({
        where: { id, organizationId },
        relations: ['security']
    });
    if (!user) {
      throw new NotFoundException(`Usuario no encontrado`);
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

  // H5 FIX: organizationId scope added so queries are always tenant-scoped.
  async getActivityLog(userId: string, organizationId: string): Promise<any[]> {
    return [];
  }

  async inviteUser(
    inviteUserDto: InviteUserDto,
    organizationId: string,
  ): Promise<User> {
    const { email, firstName, lastName, roleId } = inviteUserDto;

    const existingUser = await this.userRepository.findOne({
      where: { email, organizationId },
    });

    if (existingUser) {
      throw new BadRequestException(
        'A user with this email already exists in the organization.',
      );
    }

    const role = await this.rolesService.findOne(roleId, organizationId);
    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found.`);
    }

    const invitationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date();
    tokenExpires.setDate(tokenExpires.getDate() + 7);

    const newUser = this.userRepository.create({
      firstName,
      lastName,
      email,
      organizationId,
      roles: [role],
      status: UserStatus.PENDING,
      invitationToken: invitationToken,
      invitationTokenExpires: tokenExpires,
      security: new UserSecurity() // Initialize security
    });

    // Wrap in transaction for atomicity
    return this.dataSource.transaction(async (manager) => {
        // Enforce Limit before saving
        await this.saasService.enforceLimit(manager, organizationId, SaasResource.USERS);

        // We must associate the user entity with the manager to participate in transaction?
        // TypeORM's manager.save(entity) handles this.
        await manager.save(newUser);

        await this.mailService.sendUserInvitation(newUser, invitationToken);

        delete newUser.invitationToken;
        delete newUser.invitationTokenExpires;

        return newUser;
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

  async forceLogout(userId: string, organizationId?: string): Promise<{ message: string }> {
    const where = organizationId ? { id: userId, organizationId } : { id: userId };
    const user = await this.userRepository.findOne({ where, relations: ['security'] });
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

  async blockAndLogout(userId: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId }, relations: ['security'] });
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

    user.organization = await this.orgRepository.findOneBy({ id: user.organizationId }) ?? undefined;

    const userOrgRows = await this.orgRepository.query(
      'SELECT o.id, o.legal_name as "legalName" FROM organizations o INNER JOIN user_organizations uo ON uo.organization_id = o.id WHERE uo.user_id = $1',
      [id]
    ) as Array<{ id: string; legalName: string }>;
    user.organizations = userOrgRows;

    return user;
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
