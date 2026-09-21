import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { PlatformPermissionsGuard } from '../guards/platform-permissions.guard';
import { PlatformPermission } from '../platform-permissions';

export const PLATFORM_PERMISSIONS_KEY = 'platformPermissions';

/**
 * Require a PLATFORM right — one that no tenant role can grant and that `'*'` does not satisfy.
 *
 * For routes that act on something shared by every tenant rather than on one tenant's data: the
 * extensions catalogue, and anything added later with the same shape. A route guarded by this is
 * unreachable by a customer's administrator no matter what their role says.
 *
 * Like `@HasPermission`, it applies its guard itself, so a declaration is always enforced.
 *
 * It does NOT replace the tenant declaration. A platform route still needs `@HasPermission(...)`
 * or `@AuthenticatedOnly(reason)` for the globally-registered `PermissionsGuard`, which denies
 * anything that declares neither — `route-authorisation.spec.ts` checks that, and a platform
 * route that skipped it would be denied by default rather than reachable. The two guards compose:
 * the tenant one answers "may you use this feature at all", this one answers "may you act on the
 * platform".
 */
export const RequiresPlatformPermission = (...permissions: PlatformPermission[]) =>
  applyDecorators(
    SetMetadata(PLATFORM_PERMISSIONS_KEY, permissions),
    UseGuards(PlatformPermissionsGuard),
  );
