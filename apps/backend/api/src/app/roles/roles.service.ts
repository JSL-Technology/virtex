import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Role } from './entities/role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { hasPermission } from '@virteex/shared/util-auth';
import { UserSecurity } from '../users/entities/user-security.entity';
import type { Permission } from '../shared/permissions';
import { ConflictError, ForbiddenError, NotFoundError } from '../i18n/localized.exception';
import { I18nService } from '../i18n/i18n.service';
import { currentLanguage } from '../i18n/request-locale';

@Injectable()
export class RolesService {
    constructor(
        @InjectRepository(Role)
        private readonly roleRepository: Repository<Role>,
        private readonly userCacheService: UserCacheService,
        private readonly i18n: I18nService,
    ) { }

    /**
     * The tenant's roles, with the four system ones described in the reader's language.
     *
     * A system role's `description` column holds a catalogue key, written there when the
     * organisation was provisioned. The roles screen rendered it raw, so customers read
     * `USER.ROLE.ADMINISTRATOR_DESC` in a table. Resolving it here keeps the client from having
     * to know which descriptions are keys and which are text a user typed.
     */
    async findAllByOrg(organizationId: string): Promise<Role[]> {
        const roles = await this.roleRepository.find({ where: { organizationId } });
        const language = currentLanguage();

        return roles.map((role) => {
            if (!role.description || !this.i18n.has(role.description)) return role;
            role.description = this.i18n.translate(role.description, language);
            return role;
        });
    }

    async findOne(id: string, organizationId: string): Promise<Role> {
        const role = await this.roleRepository.findOne({ where: { id, organizationId } });
        if (!role) {
            throw new NotFoundError('ROLES.ROL_ID_NO_ENCONTRADO', { id });
        }
        return role;
    }

    /**
     * H8: an actor may only put permissions into a role that they already hold themselves.
     *
     * Matching goes through the shared `hasPermission` util so prefix wildcards are honoured.
     * It previously used a bare `actorPermissions.includes(p)`, which contradicted
     * `assertCanAssignRole` right below: an actor holding `users:*` was refused when *creating*
     * a role containing `users:create`, yet was allowed to *assign* an existing role carrying
     * exactly that permission. Same authorisation question, two different answers.
     */
    private assertAssignablePermissions(actor: AuthenticatedUser, permissions: string[]): void {
        const actorPermissions = actor?.permissions || [];

        // The global wildcard is never delegated into a role: a role carrying '*' would be a
        // second, unaudited super-admin grant.
        if (permissions.includes('*')) {
            throw new ForbiddenError('ROLES.PERMISO_TOTAL_NO_PUEDE_DELEGARSE_ROL');
        }

        if (actorPermissions.includes('*')) return;

        for (const permission of permissions) {
            if (!hasPermission(actorPermissions, [permission])) {
                throw new ForbiddenError('ROLES.NO_PUEDES_ASIGNAR_PERMISO_PORQUE_TU_NO', { permission });
            }
        }
    }

    /**
     * Role names must be unique per organization: the UI and the invite flow both address roles
     * by name, and duplicates make "Administrador" ambiguous in a way that is easy to weaponise
     * socially. Excluding `ignoreId` lets an update keep its own name.
     */
    private async assertNameAvailable(
        name: string,
        organizationId: string,
        ignoreId?: string,
    ): Promise<void> {
        const existing = await this.roleRepository.findOne({
            where: { name, organizationId },
            select: ['id'],
        });
        if (existing && existing.id !== ignoreId) {
            throw new ConflictError('ROLES.YA_EXISTE_ROL_LLAMADO_TU_ORGANIZACION', { name });
        }
    }

    // H-01 FIX: Anti privilege-escalation for ASSIGNING an existing role to a user.
    // Mirrors assertAssignablePermissions but, unlike role creation, allows delegating the
    // full wildcard role ('*') strictly to actors who themselves are super-admins.
    // This closes the gap where a user holding only `users:edit` could promote anyone
    // (including themselves) to the ADMINISTRATOR role (which carries '*').
    assertCanAssignRole(actor: AuthenticatedUser, role: Role): void {
        const actorPermissions = actor?.permissions || [];
        const actorIsWildcard = actorPermissions.includes('*');
        const rolePermissions = role?.permissions || [];

        // Assigning a role that grants the full wildcard requires the actor to be a super-admin.
        if (rolePermissions.includes('*')) {
            if (!actorIsWildcard) {
                throw new ForbiddenError('ROLES.NO_PUEDES_ASIGNAR_ROL_PRIVILEGIOS_TOTALES');
            }
            return;
        }

        // Super-admins may assign any non-wildcard role.
        if (actorIsWildcard) {
            return;
        }

        // Otherwise the actor may only assign roles whose permissions they already hold.
        // hasPermission honors prefix wildcards (e.g. 'users:*') so the check stays consistent
        // with PermissionsGuard and the shared frontend util.
        for (const permission of rolePermissions) {
            if (!hasPermission(actorPermissions, [permission])) {
                throw new ForbiddenError('ROLES.NO_PUEDES_ASIGNAR_ROL_INCLUYE_PERMISO_TU', { permission });
            }
        }
    }

    /**
     * `actor` is REQUIRED, not optional.
     *
     * It used to be `actor?`, and the escalation check ran only `if (actor)`. That is a
     * fail-open design: any future caller that forgot the argument would silently skip the
     * anti-escalation guard entirely, with nothing at the type level to catch it. Making it
     * mandatory turns that class of mistake into a compile error.
     */
    async create(
        createRoleDto: CreateRoleDto,
        organizationId: string,
        actor: AuthenticatedUser,
    ): Promise<Role> {
        this.assertAssignablePermissions(actor, createRoleDto.permissions ?? []);
        await this.assertNameAvailable(createRoleDto.name, organizationId);

        const role = this.roleRepository.create({ ...createRoleDto, organizationId });
        return this.roleRepository.save(role);
    }

    // H2 FIX: actor is required so assertAssignablePermissions validates the cloner holds all
    // permissions of the cloned role, preventing privilege escalation via copy.
    async cloneRole(id: string, organizationId: string, actor: AuthenticatedUser): Promise<Role> {
        const roleToClone = await this.findOne(id, organizationId);

        if (roleToClone.isSystemRole) {
            throw new ForbiddenError('ROLES.ROLES_SISTEMA_NO_PUEDEN_CLONAR');
        }

        const newRoleDto: CreateRoleDto = {
            name: `${roleToClone.name} (Copia)`,
            description: roleToClone.description,
            // Already validated against the catalogue when the source role was created.
            permissions: roleToClone.permissions as Permission[],
        };

        return this.create(newRoleDto, organizationId, actor);
    }

    async update(id: string, updateRoleDto: UpdateRoleDto, organizationId: string, actor: AuthenticatedUser): Promise<Role> {
        const role = await this.findOne(id, organizationId);
        if (role.isSystemRole) {
            throw new ForbiddenError('ROLES.ROLES_SISTEMA_NO_PUEDEN_SER_MODIFICADOS');
        }

        // Privilege-escalation guard. `actor` is mandatory for the same fail-closed reason as in
        // create(): an optional parameter made the whole check skippable by omission.
        if (updateRoleDto.permissions) {
            this.assertAssignablePermissions(actor, updateRoleDto.permissions);
            // An actor must also already hold everything the role currently grants, otherwise
            // they could "edit" a role more powerful than themselves — narrowing it, broadening
            // it, or simply mutating a grant they were never entitled to administer.
            this.assertCanAssignRole(actor, role);
        }

        if (updateRoleDto.name && updateRoleDto.name !== role.name) {
            await this.assertNameAvailable(updateRoleDto.name, organizationId, role.id);
        }

        return await this.roleRepository.manager.transaction(async transactionalEntityManager => {
            Object.assign(role, updateRoleDto);
            const updatedRole = await transactionalEntityManager.save(role);

            // 10/10 SECURITY: When a role is updated, we must invalidate all sessions
            // for users belonging to this role by incrementing their tokenVersion.
            const users = await transactionalEntityManager.getRepository(User)
                .createQueryBuilder('user')
                .innerJoin('user.roles', 'role')
                .where('role.id = :roleId', { roleId: role.id })
                .select(['user.id'])
                .getMany();

            if (users.length > 0) {
                const userIds = users.map(u => u.id);

                // Increment tokenVersion globally for all affected users
                await transactionalEntityManager.getRepository(UserSecurity)
                    .createQueryBuilder()
                    .update()
                    .set({ tokenVersion: () => 'token_version + 1' })
                    .where('userId IN (:...userIds)', { userIds })
                    .execute();

                // Clear cache for each user
                for (const userId of userIds) {
                    await this.userCacheService.clearUserSession(userId);
                }
            }

            return updatedRole;
        });
    }

    async remove(id: string, organizationId: string): Promise<void> {
        const role = await this.findOne(id, organizationId);
        if (role.isSystemRole) {
            throw new ForbiddenError('ROLES.ROLES_SISTEMA_NO_PUEDEN_SER_ELIMINADOS');
        }

        // H2 FIX: Deleting a role is an authorization-graph mutation. Previously `remove` only
        // detached the role row, leaving already-issued JWTs/cached sessions of users that held
        // the role with stale permissions until natural expiry. We now refuse to delete a role
        // that is still assigned to users (forcing an explicit migration first) and perform the
        // check + delete atomically so a concurrent role assignment cannot slip through the gap.
        // (OWASP ASVS V4; CWE-613/CWE-863.)
        await this.roleRepository.manager.transaction(async (manager) => {
            const assignedCount = await manager.getRepository(User)
                .createQueryBuilder('user')
                .innerJoin('user.roles', 'role')
                .where('role.id = :roleId', { roleId: role.id })
                .getCount();

            if (assignedCount > 0) {
                throw new ForbiddenError('ROLES.NO_PUEDE_ELIMINAR_ROL_ASIGNADO_USUARIO_REASIGNA', { assignedCount });
            }

            await manager.getRepository(Role).remove(role);
        });
    }
}