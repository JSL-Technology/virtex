import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformPermissionsGuard } from './platform-permissions.guard';
import { PLATFORM_PERMISSIONS_KEY } from '../decorators/platform-permission.decorator';
import { PLATFORM_PERMISSIONS } from '../platform-permissions';

/**
 * The tenant wildcard stops at the tenant boundary.
 *
 * This is the whole reason the platform tier exists. The extensions catalogue is shared by every
 * tenant — `plugins` and `plugin_versions` carry no `organization_id` — and its write routes were
 * guarded by `extensions:manage`, an ordinary tenant permission that the `'*'` of every tenant's
 * ADMINISTRATOR role satisfies. So anybody who signed up could publish a version of any extension
 * in the marketplace, and because the newest version used to be the one that executed, run that
 * code in other tenants' isolates and in their administrators' browsers.
 *
 * The guard is separate from `PermissionsGuard` precisely so it can do an EXACT match. Sharing
 * `hasPermission` would have reintroduced the hole one level down.
 */
describe('PlatformPermissionsGuard', () => {
  const reflector = new Reflector();
  const guard = new PlatformPermissionsGuard(reflector);

  function contextFor(required: string[] | undefined, permissions: string[] | null) {
    const handler = () => undefined;
    if (required) Reflect.defineMetadata(PLATFORM_PERMISSIONS_KEY, required, handler);

    return {
      getType: () => 'http',
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () =>
          permissions === null
            ? {}
            : { user: { id: 'u1', organizationId: 'org-1', permissions } },
      }),
    } as unknown as ExecutionContext;
  }

  it('lets a route that declares nothing through: the tenant guards decide', () => {
    expect(guard.canActivate(contextFor(undefined, ['*']))).toBe(true);
  });

  it('admits the exact permission', () => {
    const context = contextFor(
      [PLATFORM_PERMISSIONS.EXTENSIONS_PUBLISH],
      [PLATFORM_PERMISSIONS.EXTENSIONS_PUBLISH],
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  /**
   * The case the whole tier exists for. Every tenant's ADMINISTRATOR role carries `'*'`, and
   * `hasPermission` resolves it to "everything" — which is right inside a tenant and catastrophic
   * outside one.
   */
  it('refuses the tenant wildcard', () => {
    const context = contextFor([PLATFORM_PERMISSIONS.EXTENSIONS_PUBLISH], ['*']);
    expect(() => guard.canActivate(context)).toThrow();
  });

  it('refuses a prefix wildcard that would otherwise match', () => {
    // `hasPermission` would treat `platform:*` as covering `platform:extensions:publish`. An
    // exact match does not, which is why this guard does not use it.
    const context = contextFor([PLATFORM_PERMISSIONS.EXTENSIONS_PUBLISH], ['platform:*']);
    expect(() => guard.canActivate(context)).toThrow();
  });

  it('refuses a different platform permission', () => {
    const context = contextFor(
      [PLATFORM_PERMISSIONS.EXTENSIONS_PUBLISH],
      [PLATFORM_PERMISSIONS.EXTENSIONS_REVOKE],
    );
    expect(() => guard.canActivate(context)).toThrow();
  });

  it('refuses a request with no principal at all', () => {
    expect(() => guard.canActivate(contextFor([PLATFORM_PERMISSIONS.EXTENSIONS_PUBLISH], null)))
      .toThrow();
  });

  it('requires every declared permission, not merely one of them', () => {
    const context = contextFor(
      [PLATFORM_PERMISSIONS.EXTENSIONS_PUBLISH, PLATFORM_PERMISSIONS.EXTENSIONS_REVOKE],
      [PLATFORM_PERMISSIONS.EXTENSIONS_PUBLISH],
    );
    expect(() => guard.canActivate(context)).toThrow();
  });
});
