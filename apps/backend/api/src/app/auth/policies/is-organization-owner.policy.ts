
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IPolicy } from '../guards/permissions/permissions.guard';
import { AuthenticatedRequest } from '@virteex/shared/util-auth';
import { User } from '../../users/entities/user.entity/user.entity';
import { RoleEnum } from '../../roles/enums/role.enum';
import { PERMISSIONS } from '../../shared/permissions';

/**
 * M-05 FIX: Correct, effective ABAC ownership/tenant policy.
 *
 * Previous implementation was inert: it compared a USER :id against the organization id
 * and checked a non-existent role name ('ADMIN' instead of 'ADMINISTRATOR'), so it always
 * returned false and only "worked" because PermissionsGuard short-circuited for wildcard
 * admins before policies ran.
 *
 * Now:
 *  - Resource-scoped routes (`:id` present, e.g. DELETE /users/:id): the target resource
 *    must belong to the caller's organization (tenant isolation / ownership).
 *  - Self-scoped routes (no `:id`, e.g. PATCH /organizations/profile): the caller must
 *    actually be an organization owner/administrator.
 */
@Injectable()
export class IsOrganizationOwnerPolicy implements IPolicy {
    private readonly logger = new Logger(IsOrganizationOwnerPolicy.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {}

    async can(user: any, request: AuthenticatedRequest): Promise<boolean> {
        const resourceId = (request.params as Record<string, string> | undefined)?.id;

        // Resource-scoped route: verify the target belongs to the caller's organization.
        if (resourceId) {
            const targetUser = await this.userRepository.findOne({
                where: { id: resourceId },
                select: ['id', 'organizationId'],
            });

            if (targetUser) {
                const allowed = targetUser.organizationId === user.organizationId;
                if (!allowed) {
                    this.logger.warn(
                        `IsOrganizationOwnerPolicy denied: user ${user.id} (org ${user.organizationId}) attempted cross-tenant access to user ${resourceId}.`,
                    );
                }
                return allowed;
            }

            // The :id may itself be an organization id (organization-scoped routes).
            return resourceId === user.organizationId;
        }

        // Self-scoped route: require organization ownership/administration.
        return this.isOrganizationOwner(user);
    }

    private isOrganizationOwner(user: any): boolean {
        const roles: Array<{ name?: string }> = user?.roles || [];
        if (roles.some((r) => r?.name === RoleEnum.ADMINISTRATOR)) {
            return true;
        }
        const permissions: string[] = user?.permissions || [];
        return permissions.includes('*') || permissions.includes(PERMISSIONS.SETTINGS_EDIT_COMPANY);
    }
}

// Backwards-compatible alias. `users.controller.ts` imports `IsOrganizationOwner`, while
// `organizations.controller.ts` imports `IsOrganizationOwnerPolicy`; export both names so the
// same provider class is referenced everywhere (the bare `IsOrganizationOwner` import was
// previously undefined).
export const IsOrganizationOwner = IsOrganizationOwnerPolicy;
