import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Role } from './entities/role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../security/principal';
import { hasPermission } from '@virteex/shared/util-auth';
import { isPlatformPermission } from '../security/platform-permissions';
import { RoleDelegationPort } from '../auth/ports/role-delegation.port';
/**
 * A role as the API reports it.
 *
 * Exactly one of `description` and `descriptionKey` is set: the first when a customer typed the
 * text, the second when the value is a catalogue key this product wrote at provisioning time. The
 * client cannot guess which, so the response says.
 */
export type RoleView = Omit<Role, 'description'> & {
    description: string | null;
    descriptionKey: string | null;
};
import { UserSecurity } from '../users/entities/user-security.entity';
import type { Permission } from '../shared/permissions';
import { ConflictError, ForbiddenError, NotFoundError } from '../i18n/localized.exception';
import { I18nService } from '../i18n/i18n.service';

@Injectable()
export class RolesService extends RoleDelegationPort {
    constructor(
        @InjectRepository(Role)
        private readonly roleRepository: Repository<Role>,
        private readonly userCacheService: UserCacheService,
        private readonly i18n: I18nService,
    ) {
        super();
    }

    /**
     * {@link RoleDelegationPort}: the same rule as `assertCanAssignRole`, reachable by id.
     *
     * For callers outside this module that hold a role id rather than the entity — today, the SSO
     * administration surface, where `defaultRoleId` decides the role every JIT-provisioned user is
     * created with. Scoped to the tenant, so an id from another organization is "not found"
     * rather than assignable.
     */
    async assertCanAssignRoleById(
        actor: AuthenticatedUser,
        roleId: string,
        organizationId: string,
    ): Promise<void> {
        const role = await this.roleRepository.findOne({ where: { id: roleId, organizationId } });
        if (!role) {
            throw new NotFoundError('roles.role_id_not_found', { id: roleId });
        }
        this.assertCanAssignRole(actor, role);
    }

    /**
     * The tenant's roles, saying which descriptions are keys and which are text somebody typed.
     *
     * A system role's `description` column holds a catalogue key, written there when the
     * organisation was provisioned; a role the customer created holds whatever they wrote. The
     * screen rendered the column raw, so customers read `USER.ROLE.ADMINISTRATOR_DESC` in a table.
     *
     * The first fix was to translate it here and overwrite the column on the way out. That put UI
     * prose in an API response and still left the client unable to tell the two cases apart — it
     * got a string and hoped. The response now carries `descriptionKey` when the description IS a
     * key, and the client translates it, which is also what lets the roles screen follow a language
     * switch without refetching.
     */
    async findAllByOrg(organizationId: string): Promise<RoleView[]> {
        const roles = await this.roleRepository.find({ where: { organizationId } });

        return roles.map((role) => {
            if (!role.description || !this.i18n.has(role.description)) {
                return { ...role, descriptionKey: null } as RoleView;
            }
            return { ...role, description: null, descriptionKey: role.description } as RoleView;
        });
    }

    async findOne(id: string, organizationId: string): Promise<Role> {
        const role = await this.roleRepository.findOne({ where: { id, organizationId } });
        if (!role) {
            throw new NotFoundError('roles.role_id_not_found', { id });
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
            throw new ForbiddenError('roles.full_permission_cannot_delegated_role');
        }

        // Nor is any PLATFORM permission, by anybody, ever.
        //
        // These are rights over the shared catalogue that every tenant reads — publishing an
        // extension, revoking one, running arbitrary code in the sandbox. They belong to
        // platform roles, which carry a NULL organization_id and are seeded rather than created
        // here. Without this line a tenant administrator holding '*' would fall through the
        // `actorPermissions.includes('*')` shortcut below and be able to mint a tenant role
        // carrying `platform:extensions:publish` — which is the hole the whole tier exists to
        // close, reopened one level down.
        const platform = permissions.filter(isPlatformPermission);
        if (platform.length) {
            throw new ForbiddenError('roles.platform_permission_cannot_delegated_role', {
                permission: platform[0],
            });
        }

        if (actorPermissions.includes('*')) return;

        for (const permission of permissions) {
            if (!hasPermission(actorPermissions, [permission])) {
                throw new ForbiddenError('roles.you_cannot_assign_permission_permission_because', { permission });
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
            throw new ConflictError('roles.role_named_name_already_exists_your', { name });
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

        // A role carrying a platform permission is never assignable from here, by anybody.
        //
        // `assertAssignablePermissions` stops such a role being CREATED, and this stops a role
        // that already carries one — a seeded platform role, or a row written before that rule
        // existed — being handed to a tenant member. Both doors, because the escalation only needs
        // one of them: the wildcard shortcut two lines below would otherwise let a tenant
        // administrator assign a platform role to themselves.
        const platform = rolePermissions.filter(isPlatformPermission);
        if (platform.length) {
            throw new ForbiddenError('roles.you_cannot_assign_role_with_platform', {
                permission: platform[0],
            });
        }

        // Assigning a role that grants the full wildcard requires the actor to be a super-admin.
        if (rolePermissions.includes('*')) {
            if (!actorIsWildcard) {
                throw new ForbiddenError('roles.you_cannot_assign_role_with_full');
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
                throw new ForbiddenError('roles.you_cannot_assign_role_includes_permission', { permission });
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
            throw new ForbiddenError('roles.system_roles_cannot_cloned');
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
            throw new ForbiddenError('roles.system_roles_cannot_modified');
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
            throw new ForbiddenError('roles.system_roles_cannot_deleted');
        }

        // H2 FIX: Deleting a role is an authorization-graph mutation. Previously `remove` only
        // detached the role row, leaving already-issued JWTs/cached sessions of users that held
        // the role with stale permissions until natural expiry. We now refuse to delete a role
        // that is still assigned to users (forcing an explicit migration first) and perform the
        // check + delete atomically so a concurrent role assignment cannot slip through the gap.
        // (OWASP ASVS V4; CWE-613/CWE-863.)
        await this.roleRepository.manager.transaction(async (manager) => {
            const assignedCount = await manager.getRepository(User)
                // tenant-scope-guard-allow: usuarios que tienen asignado un rol, acotado por `roleId`. El rol
                // ya fue resuelto dentro de la empresa del llamante.
                .createQueryBuilder('user')
                .innerJoin('user.roles', 'role')
                .where('role.id = :roleId', { roleId: role.id })
                .getCount();

            if (assignedCount > 0) {
                throw new ForbiddenError('roles.role_assigned_assigned_count_user_cannot', { assignedCount });
            }

            await manager.getRepository(Role).remove(role);
        });
    }
}