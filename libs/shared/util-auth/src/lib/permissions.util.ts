/**
 * Prefix of the platform tier: rights over what every tenant shares (the extensions catalogue,
 * shared reference data, statutory payroll tables). No tenant role can hold one.
 */
export const PLATFORM_PERMISSION_PREFIX = 'platform:';

/**
 * Whether a set of held permissions satisfies every required one.
 *
 * `'*'` and prefix wildcards (`'sales:*'`) satisfy TENANT permissions only. A platform permission
 * is satisfied by itself and nothing else: a tenant administrator's `'*'` is total power over their
 * own tenant and no power at all over what every tenant shares. The API's platform guard already
 * compared exactly; this is the same rule in the one matcher the browser uses too, so a screen can
 * no longer offer a tenant administrator a platform action the server will refuse.
 */
export function hasPermission(
  userPermissions: string[] | undefined | null,
  requiredPermissions: string[]
): boolean {
  if (!userPermissions) {
    return false;
  }

  return requiredPermissions.every((req) => {
    if (req.startsWith(PLATFORM_PERMISSION_PREFIX)) {
      return userPermissions.includes(req);
    }

    // Super-admin wildcard, within the tenant.
    if (userPermissions.includes('*')) {
      return true;
    }

    return userPermissions.some((userPerm) => {
      // Exact match
      if (userPerm === req) {
        return true;
      }
      // Wildcard match (e.g. 'sales:*' matches 'sales:create')
      if (userPerm.endsWith('*')) {
        const prefix = userPerm.slice(0, -1);
        return req.startsWith(prefix);
      }
      return false;
    });
  });
}
