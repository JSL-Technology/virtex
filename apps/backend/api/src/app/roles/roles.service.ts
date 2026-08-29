import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
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

@Injectable()
export class RolesService {
    constructor(
        @InjectRepository(Role)
        private readonly roleRepository: Repository<Role>,
        private readonly userCacheService: UserCacheService
    ) { }

    findAllByOrg(organizationId: string) {
        return this.roleRepository.find({ where: { organizationId } });
    }

    async findOne(id: string, organizationId: string): Promise<Role> {
        const role = await this.roleRepository.findOne({ where: { id, organizationId } });
        if (!role) {
            throw new NotFoundException(`Rol con ID "${id}" no encontrado.`);
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
            throw new ForbiddenException('El permiso total (*) no puede delegarse a un rol.');
        }

        if (actorPermissions.includes('*')) return;

        for (const permission of permissions) {
            if (!hasPermission(actorPermissions, [permission])) {
                throw new ForbiddenException(
                    `No puedes asignar el permiso "${permission}" porque tú no lo posees.`,
                );
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
            throw new ConflictException(`Ya existe un rol llamado "${name}" en tu organización.`);
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
                throw new ForbiddenException(
                    'No puedes asignar un rol con privilegios totales (*).',
                );
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
                throw new ForbiddenException(
                    `No puedes asignar un rol que incluye el permiso "${permission}" que tú no posees.`,
                );
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
            throw new ForbiddenException('Los roles del sistema no se pueden clonar.');
        }

        const newRoleDto: CreateRoleDto = {
            name: `${roleToClone.name} (Copia)`,
            description: roleToClone.description,
            permissions: roleToClone.permissions,
        };

        return this.create(newRoleDto, organizationId, actor);
    }

    async update(id: string, updateRoleDto: UpdateRoleDto, organizationId: string, actor: AuthenticatedUser): Promise<Role> {
        const role = await this.findOne(id, organizationId);
        if (role.isSystemRole) {
            throw new ForbiddenException('Los roles del sistema no pueden ser modificados.');
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
            throw new ForbiddenException('Los roles del sistema no pueden ser eliminados.');
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
                throw new ForbiddenException(
                    `No se puede eliminar un rol asignado a ${assignedCount} usuario(s). Reasigna esos usuarios a otro rol antes de eliminarlo.`,
                );
            }

            await manager.getRepository(Role).remove(role);
        });
    }
}