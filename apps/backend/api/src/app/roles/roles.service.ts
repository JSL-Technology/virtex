import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

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

    create(createRoleDto: CreateRoleDto, organizationId: string, actor?: AuthenticatedUser): Promise<Role> {
        if (actor && createRoleDto.permissions) {
            this.assertAssignablePermissions(actor, createRoleDto.permissions);
        }
        const role = this.roleRepository.create({ ...createRoleDto, organizationId });
        return this.roleRepository.save(role);
    }

    async cloneRole(id: string, organizationId: string): Promise<Role> {
        const roleToClone = await this.findOne(id, organizationId);

        if (roleToClone.isSystemRole) {
            throw new ForbiddenException('Los roles del sistema no se pueden clonar.');
        }

        const newRoleDto: CreateRoleDto = {
            name: `${roleToClone.name} (Copia)`,
            description: roleToClone.description,
            permissions: roleToClone.permissions,
        };

        return this.create(newRoleDto, organizationId);
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

        // Invalidate sessions for all users who have this role
        // This is expensive but necessary for security when permissions change.
        // We do it asynchronously to not block the response too much?
        // Actually, we must ensure consistency.
        // Finding all users with this role:
        const users = await this.roleRepository.manager.getRepository(User)
            .createQueryBuilder('user')
            .innerJoin('user.roles', 'role')
            .where('role.id = :roleId', { roleId: role.id })
            .select(['user.id'])
            .getMany();

        for (const user of users) {
             await this.userCacheService.clearUserSession(user.id);
        }

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