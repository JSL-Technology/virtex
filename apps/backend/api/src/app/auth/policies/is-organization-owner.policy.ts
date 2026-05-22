
import { Injectable, Logger } from '@nestjs/common';
import { IPolicy } from '../guards/permissions/permissions.guard';
import { AuthenticatedRequest } from '@virteex/shared/util-auth';

@Injectable()
export class IsOrganizationOwnerPolicy implements IPolicy {
    private readonly logger = new Logger(IsOrganizationOwnerPolicy.name);

    async can(user: any, request: AuthenticatedRequest): Promise<boolean> {
        // Example ABAC Logic:
        // User must be the owner of the resource OR have the 'ADMIN' role
        // Resource ID is typically in params (e.g. /organizations/:id)

        const resourceId = request.params?.id;

        this.logger.debug(`Checking IsOrganizationOwnerPolicy for user ${user.id} on resource ${resourceId}`);

        if (user.roles?.some((r: any) => r.name === 'ADMIN')) {
            return true;
        }

        // Real ABAC implementation would query the resource to check ownership
        // Here we just check if the user belongs to the organization in the param (context-aware)
        if (resourceId && user.organization?.id === resourceId) {
            return true;
        }

        return false;
    }
}
