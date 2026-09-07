import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Type } from '@nestjs/common';
import { Reflector, ModuleRef } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../decorators/permissions.constants';
import { IS_PUBLIC_KEY } from '../../decorators/public.decorator';
import { AUTHENTICATED_ONLY_KEY } from '../../decorators/authenticated-only.decorator';
import { Permission } from '../../../shared/permissions';
import { AuthenticatedRequest, hasPermission } from '@virteex/shared/util-auth';

// Interface for a Policy (Context-Aware Check)
export interface IPolicy {
  can(user: any, request: any): boolean | Promise<boolean>;
}

export type PermissionOrPolicy = Permission | Type<IPolicy>;

import { Logger } from '@nestjs/common';
import { ForbiddenError } from '../../../i18n/localized.exception';

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

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { user } = request;

    if (!requiredPermissions) {
      // Nothing declared. This used to return true, and that default is why the control did not
      // hold: 102 route handlers reached production reachable by any authenticated member of the
      // tenant — creating a product, editing a supplier, reading the finance dashboard, querying
      // the analytical store — not because anyone judged them open, but because declaring a
      // requirement per endpoint means forgetting it per endpoint. The same failure was already
      // measured twice in this codebase, on CSRF ("4 of 50") and on entitlement ("1 of 67"), and
      // both were fixed the same way: make the guard global and the exemption explicit.
      //
      // So the default is now deny, and a route with no permission requirement has to say so with
      // @AuthenticatedOnly(reason) — which forces the author to write down why, and the reviewer
      // to agree with a sentence rather than with an absence.
      if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])) {
        // Unauthenticated by design; JwtAuthGuard already let it through and there is no user to
        // check permissions against.
        return true;
      }

      const authenticatedOnly = this.reflector.getAllAndOverride<string>(AUTHENTICATED_ONLY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

      if (authenticatedOnly) {
        // Being signed in IS the authorisation for this route, and the author said why.
        if (!user) {
          throw new ForbiddenError('AUTH.NO_TIENES_PERMISOS_REALIZAR_ESTA_ACCION');
        }
        return true;
      }

      // Fail closed, and make the omission loud rather than silent: a route that reaches here is
      // a bug in the route, not in the request, and it is invisible to the caller by design.
      this.logger.error(
        `Route declares neither @HasPermission nor @AuthenticatedOnly and is therefore denied: ` +
          `${context.getClass().name}.${context.getHandler().name}`,
      );
      throw new ForbiddenError('AUTH.NO_TIENES_PERMISOS_REALIZAR_ESTA_ACCION');
    }

    if (!user || !user.permissions) {
        throw new ForbiddenError('AUTH.NO_TIENES_PERMISOS_REALIZAR_ESTA_ACCION');
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
                throw new ForbiddenError('AUTH.NO_TIENES_PERMISOS_REALIZAR_ESTA_ACCION');
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
                     throw new ForbiddenError('AUTH.CONFIGURATION_ERROR_POLICY_NOT_FOUND');
                }

                if (policy) {
                    const allowed = await policy.can(user, request);
                    if (!allowed) {
                        throw new ForbiddenError('AUTH.NO_CUMPLES_POLITICA_ACCESO_REQUERIDA');
                    }
                }
             } catch (e) {
                 if (e instanceof ForbiddenException) throw e;
                 this.logger.error(`Policy check failed: ${(e as Error).message}`, (e as Error).stack);
                 throw new ForbiddenError('AUTH.ERROR_VALIDANDO_POLITICA_SEGURIDAD');
             }
        }
    }

    return true;
  }
}
