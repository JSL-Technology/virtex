import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '../principal';
import { ForbiddenError } from '../../i18n/localized.exception';
import {
  PLATFORM_PERMISSIONS_KEY,
} from '../decorators/platform-permission.decorator';
import { PlatformPermission, hasPlatformPermission } from '../platform-permissions';

/**
 * Enforces the platform tier.
 *
 * Separate from `PermissionsGuard` rather than folded into it, and that is the point: this guard
 * does an EXACT match and never consults `hasPermission`, so the tenant wildcard `'*'` — which
 * every tenant's ADMINISTRATOR role carries — cannot satisfy a platform right. Sharing the
 * matcher would have reintroduced exactly the hole the tier exists to close.
 *
 * Applied by `@RequiresPlatformPermission(...)`, which attaches this guard itself so the
 * declaration and the enforcement cannot come apart — the property `permissions-enforced.spec.ts`
 * pins for the tenant tier, for the same reason.
 */
@Injectable()
export class PlatformPermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PlatformPermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlatformPermission[]>(
      PLATFORM_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Not a platform route. The tenant guards decide.
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenError('auth.you_do_not_have_permission_perform');
    }

    const missing = required.filter(
      (permission) => !hasPlatformPermission(user.permissions, permission),
    );

    if (missing.length) {
      // Logged loudly: a tenant administrator reaching a platform route is either a
      // misconfiguration or somebody probing, and both are worth seeing.
      this.logger.warn(
        {
          event: 'platform_permission_denied',
          userId: user.id,
          organizationId: user.organizationId,
          missing,
        },
        '[SECURITY] Platform permission denied',
      );
      // Same generic message the tenant guard returns: the caller learns nothing about which
      // platform rights exist.
      throw new ForbiddenError('auth.you_do_not_have_permission_perform');
    }

    return true;
  }
}
