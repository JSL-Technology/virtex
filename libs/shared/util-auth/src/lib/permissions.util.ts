/**
 * Prefix of the platform tier: rights over what every tenant shares (the extensions catalogue,
 * shared reference data, statutory payroll tables). No tenant role can hold one.
 */
export const PLATFORM_PERMISSION_PREFIX = 'platform:';

/**
 * Permissions that another permission brings with it: changing something includes reading it.
 *
 * A read permission added after the fact (`settings:view_company`, `workflows:view`) would
 * otherwise lock out every role written before it — a custom role that may edit the company's
 * configuration, and was never ticked «view» because that box did not exist, would meet a 403 on
 * opening the page it administers. Declared here, in the one matcher the API and the browser
 * share, rather than copied into every stored role: nobody has to remember to tick both boxes,
 * and the two sides cannot disagree about what a role may read.
 *
 * Only tenant permissions belong here; a platform permission is satisfied by itself alone.
 */
export const IMPLIED_PERMISSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'settings:edit_company': ['settings:view_company'],
  'workflows:manage': ['workflows:view'],
});

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
      // A permission that brings this one with it (editing implies reading).
      if (IMPLIED_PERMISSIONS[userPerm]?.includes(req)) {
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
