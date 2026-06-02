import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { hasPermission } from '@virteex/shared/util-auth';

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

    // H8 FIX: Assert that the actor can only assign permissions they already hold (no privilege escalation).
    private assertAssignablePermissions(actor: AuthenticatedUser, permissions: string[]): void {
        const actorPermissions = actor.permissions || [];
        const isWildcard = actorPermissions.includes('*');
        if (permissions.includes('*')) {
            throw new ForbiddenException('Wildcard permission (*) cannot be delegated to roles.');
        }
        if (!isWildcard) {
            for (const p of permissions) {
                if (!actorPermissions.includes(p)) {
                    throw new ForbiddenException(`You cannot assign permission "${p}" that you do not hold.`);
                }
            }
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

    create(createRoleDto: CreateRoleDto, organizationId: string, actor?: AuthenticatedUser): Promise<Role> {
        if (actor && createRoleDto.permissions) {
            this.assertAssignablePermissions(actor, createRoleDto.permissions);
        }
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

    async update(id: string, updateRoleDto: UpdateRoleDto, organizationId: string, actor?: AuthenticatedUser): Promise<Role> {
        const role = await this.findOne(id, organizationId);
        if (role.isSystemRole) {
            throw new ForbiddenException('Los roles del sistema no pueden ser modificados.');
        }
        if (actor && updateRoleDto.permissions) {
            this.assertAssignablePermissions(actor, updateRoleDto.permissions);
        }
        Object.assign(role, updateRoleDto);

        const updatedRole = await this.roleRepository.save(role);

        // H12 FIX: Invalidate in parallel instead of sequentially to avoid O(n) await chains
        // for roles with large user memberships.
        const users = await this.roleRepository.manager.getRepository(User)
            .createQueryBuilder('user')
            .innerJoin('user.roles', 'role')
            .where('role.id = :roleId', { roleId: role.id })
            .select(['user.id'])
            .getMany();

        await Promise.all(users.map((u) => this.userCacheService.clearUserSession(u.id)));

        return updatedRole;
    }

    async remove(id: string, organizationId: string): Promise<void> {
        const role = await this.findOne(id, organizationId);
        if (role.isSystemRole) {
            throw new ForbiddenException('Los roles del sistema no pueden ser eliminados.');
        }
        await this.roleRepository.remove(role);
    }
}