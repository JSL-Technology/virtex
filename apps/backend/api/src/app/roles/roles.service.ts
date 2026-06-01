import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Role } from './entities/role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { User } from '../users/entities/user.entity/user.entity';
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
        await this.roleRepository.remove(role);
    }
}