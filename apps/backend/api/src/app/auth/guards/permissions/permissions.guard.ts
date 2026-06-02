import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Type } from '@nestjs/common';
import { Reflector, ModuleRef } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { Permission } from '../../../shared/permissions';
import { AuthenticatedRequest, hasPermission } from '@virteex/shared/util-auth';

// Interface for a Policy (Context-Aware Check)
export interface IPolicy {
  can(user: any, request: any): boolean | Promise<boolean>;
}

export type PermissionOrPolicy = Permission | Type<IPolicy>;

import { Logger } from '@nestjs/common';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
      private reflector: Reflector,
      private moduleRef: ModuleRef
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<PermissionOrPolicy[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { user } = request;

    if (!user || !user.permissions) {
        throw new ForbiddenException('No tienes permisos para realizar esta acción.');
    }

    // L-07 FIX: delegate permission matching to the shared `hasPermission` util so the
    // backend interprets prefix wildcards (e.g. 'users:*') and the global '*' exactly like
    // the frontend guard and impersonation service. Avoids contradictory authz decisions.
    //
    // M-05 FIX: do NOT short-circuit on '*' before policies run. String permissions are
    // satisfied by '*' (handled inside hasPermission), but ABAC policies (e.g. tenant
    // ownership) must still be evaluated even for super-admins.
    for (const requirement of requiredPermissions) {
        if (typeof requirement === 'string') {
            // L-07: wildcard-aware matching via the shared util (handles 'users:*' and '*'),
            // consistent with the frontend guard and impersonation service.
            if (!hasPermission(user.permissions, [requirement])) {
                // H-09 FIX: Never expose internal permission names in HTTP responses.
                // Log the detail internally; return a generic message to the client
                // (OWASP Error Handling Cheat Sheet; CWE-209).
                this.logger.warn(`Permission denied: user=${user.id}, missing=${requirement}`);
                throw new ForbiddenException('No tienes permisos para realizar esta acción.');
            }
        } else if (typeof requirement === 'function') { // It's a Class (Constructor)
             try {
                // Use ModuleRef to resolve the policy, allowing DI inside policies.
                // 10/10 ARCHITECTURE: Policies MUST be providers. No 'new Class()' allowed.
                let policy: IPolicy;
                try {
                    policy = this.moduleRef.get(requirement, { strict: false });
                } catch (e) {
                    // If not found in DI container, we log error and fail secure.
                    // We do NOT manually instantiate, as that breaks DI contract.
                     this.logger.error(`Policy ${requirement.name} not found in DI container. Make sure it is decorated with @Injectable() and provided in the module.`);
                     throw new ForbiddenException('Configuration Error: Policy not found.');
                }

                if (policy) {
                    const allowed = await policy.can(user, request);
                    if (!allowed) {
                        throw new ForbiddenException('No cumples con la política de acceso requerida.');
                    }
                }
             } catch (e) {
                 if (e instanceof ForbiddenException) throw e;
                 this.logger.error(`Policy check failed: ${(e as Error).message}`, (e as Error).stack);
                 throw new ForbiddenException('Error validando política de seguridad.');
             }
        }
    }

    return true;
  }
}
