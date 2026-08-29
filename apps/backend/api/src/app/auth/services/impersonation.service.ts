import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { UserCacheService } from '../modules/user-cache.service';
import { hasPermission } from '@virteex/shared/util-auth';

@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly userCacheService: UserCacheService
  ) {}

  private hashPii(value: string): string {
    return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex').slice(0, 12);
  }

  private permissionsOf(user: Pick<User, 'roles'>): string[] {
    return [...new Set((user.roles || []).flatMap((role) => role.permissions || []))];
  }

  /**
   * C-4 FIX: decide seniority from the permission set, not from the role's name.
   *
   * The previous implementation scored users against a hardcoded map
   * (`ADMINISTRATOR: 100, ACCOUNTANT: 50, SELLER: 50, MEMBER: 10`) while the roles module lets
   * every organization define arbitrary role names. Any custom role therefore scored 0, and the
   * check `targetLevel > adminLevel` compared 0 > 0 — false. The result was a full privilege
   * escalation: a user holding only `users:impersonate` with a custom role could impersonate a
   * user whose custom role carried `*`, inheriting super-admin access and bypassing every
   * anti-escalation guard in RolesService.
   *
   * The correct question is not "who ranks higher" but "would this grant the operator anything
   * they do not already have". An operator may only impersonate someone whose permissions are a
   * subset of their own, which is invariant to naming and works for arbitrary custom roles.
   */
  private assertNoPrivilegeGain(actorPermissions: string[], target: User): void {
    const targetPermissions = this.permissionsOf(target);

    // The wildcard is absolute: only another super-admin may assume it.
    if (targetPermissions.includes('*') && !actorPermissions.includes('*')) {
      throw new ForbiddenException(
        'No puedes suplantar a un usuario con privilegios totales (*).',
      );
    }

    for (const permission of targetPermissions) {
      // hasPermission understands prefix wildcards ('users:*'), so an operator holding
      // 'users:*' legitimately covers a target's 'users:read'. This keeps the decision
      // consistent with PermissionsGuard and RolesService.
      if (!hasPermission(actorPermissions, [permission])) {
        throw new ForbiddenException(
          'No puedes suplantar a un usuario con permisos que tú no posees.',
        );
      }
    }
  }

  async validateImpersonationRequest(adminUser: User, targetUserId: string): Promise<User> {
    this.logger.warn({
      event: 'impersonation_attempt',
      adminId: adminUser.id,
      adminEmailHash: this.hashPii(adminUser.email),
      targetId: targetUserId,
    }, '[AUDIT] Impersonation attempt');

    // Impersonating while already impersonating would make the audit trail ambiguous about who
    // the real operator is, and would let a chain launder privileges one hop at a time.
    if (adminUser.isImpersonating) {
      throw new ForbiddenException(
        'Ya estás suplantando a otro usuario. Finaliza la sesión actual antes de iniciar otra.',
      );
    }

    if (adminUser.id === targetUserId) {
      throw new BadRequestException('No puedes suplantarte a ti mismo.');
    }

    const actorPermissions = this.permissionsOf(adminUser);
    if (!hasPermission(actorPermissions, ['users:impersonate'])) {
      this.logger.warn(
        { event: 'impersonation_denied', adminId: adminUser.id, reason: 'missing_permission' },
        '[SECURITY] Impersonation denied',
      );
      throw new ForbiddenException('No tienes permisos para suplantar usuarios.');
    }

    const targetUser = await this.userRepository.findOne({
      where: { id: targetUserId },
      relations: ['roles'],
    });

    if (!targetUser) {
      throw new NotFoundException('El usuario a suplantar no fue encontrado.');
    }

    // Strict tenant isolation: impersonation must never cross an organization boundary.
    if (targetUser.organizationId !== adminUser.organizationId) {
      this.logger.warn(
        { event: 'impersonation_denied', adminId: adminUser.id, reason: 'cross_org' },
        '[SECURITY] Impersonation denied: cross-organization',
      );
      // Deliberately the same message as "not found" would be, so this cannot be used to probe
      // for the existence of user ids in other tenants.
      throw new NotFoundException('El usuario a suplantar no fue encontrado.');
    }

    // Assuming a suspended or archived account would resurrect access that was deliberately cut.
    if (targetUser.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('No puedes suplantar a un usuario que no está activo.');
    }

    this.assertNoPrivilegeGain(actorPermissions, targetUser);

    this.logger.log(
      { event: 'impersonation_authorized', adminId: adminUser.id, targetId: targetUser.id },
      '[AUDIT] Impersonation authorized',
    );
    return targetUser;
  }

  async validateStopImpersonation(impersonatingUser: User): Promise<User> {
    if (!impersonatingUser.isImpersonating || !impersonatingUser.originalUserId) {
      throw new BadRequestException(
        'No se encontró una sesión de suplantación activa para detener.',
      );
    }

    const adminUser = await this.userRepository.findOne({
      where: { id: impersonatingUser.originalUserId },
      relations: ['roles'],
    });

    if (!adminUser) {
      throw new NotFoundException('La cuenta del administrador original no fue encontrada.');
    }
    if (adminUser.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('La cuenta del administrador original ya no está activa.');
    }

    await this.userCacheService.clearUserSession(impersonatingUser.id);

    this.logger.log(
      { event: 'impersonation_ended', targetId: impersonatingUser.id, adminId: adminUser.id },
      '[AUDIT] Impersonation ended',
    );
    return adminUser;
  }
}
