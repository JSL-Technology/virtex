import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Type, Inject } from '@nestjs/common';
import { Reflector, ModuleRef } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { Permission } from '../../../shared/permissions';
import { AuthenticatedRequest } from '@virteex/shared/util-auth';

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

    if (user.permissions.includes('*')) {
      return true;
    }

    for (const requirement of requiredPermissions) {
        if (typeof requirement === 'string') {
            // It's a static permission string
            if (!user.permissions.includes(requirement)) {
                throw new ForbiddenException(`Te falta el permiso: ${requirement}`);
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
