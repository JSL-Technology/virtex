import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { User } from '../users/entities/user.entity/user.entity';

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

    create(createRoleDto: CreateRoleDto, organizationId: string): Promise<Role> {
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

    async update(id: string, updateRoleDto: UpdateRoleDto, organizationId: string): Promise<Role> {
        const role = await this.findOne(id, organizationId);
        if (role.isSystemRole) {
            throw new ForbiddenException('Los roles del sistema no pueden ser modificados.');
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