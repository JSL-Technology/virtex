/**
 * Rights over the PLATFORM, as distinct from rights inside a tenant.
 *
 * ## Why this tier has to exist
 *
 * Every permission in `PERMISSIONS` is a tenant permission: it is granted by a role that carries
 * an `organization_id`, and the ADMINISTRATOR role every tenant is created with carries `'*'`,
 * which satisfies all of them (`hasPermission`, `libs/shared/util-auth`). That is correct for
 * anything scoped to one customer's data.
 *
 * It is wrong for anything shared by all of them. The extensions catalogue — `plugins` and
 * `plugin_versions` — is deliberately global: an extension is authored once and offered to every
 * tenant, so those tables carry no `organization_id`. But its write routes were guarded by
 * `extensions:manage`, an ordinary tenant permission. The consequence was direct: anybody who
 * signed up became an administrator of their own tenant, therefore held `'*'`, therefore could
 * publish a new version of ANY extension in the catalogue — including one other tenants had
 * already consented to and granted capabilities — and `resolveVersion` serves the most recent
 * version, so that code then ran in those tenants' isolates and in their administrators'
 * browsers. Revoking was the same shape in reverse: one call withdrew an extension from everyone.
 *
 * ## How a platform permission is different
 *
 * `UserIdentityService.permissionsFor` already understands a role with a NULL `organization_id`
 * as applying everywhere, and calls those "platform-level roles (support, operations) […] seeded,
 * not self-assignable". This is that idea made usable: the permissions such a role carries are
 * listed here, and `RolesService` refuses to put any of them into a tenant role, so no tenant
 * administrator can grant one to themselves or to anybody else.
 *
 * `'*'` does NOT satisfy these. `hasPermission` is deliberately not consulted for them — see
 * `hasPlatformPermission` below — because the whole point is that the tenant wildcard stops at
 * the tenant boundary.
 */
export const PLATFORM_PERMISSIONS = {
  /** Publish a new extension, or a new version of an existing one, to the shared catalogue. */
  EXTENSIONS_PUBLISH: 'platform:extensions:publish',
  /** Withdraw an extension from every tenant at once. */
  EXTENSIONS_REVOKE: 'platform:extensions:revoke',
  /** Run arbitrary, unpublished code in the sandbox — a development and incident-response tool. */
  EXTENSIONS_RUN_ARBITRARY_CODE: 'platform:extensions:run_arbitrary_code',
} as const;

export type PlatformPermission =
  (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS];

export const ALL_PLATFORM_PERMISSIONS: readonly string[] = Object.values(PLATFORM_PERMISSIONS);

/** The namespace every platform permission lives in, so a new one cannot be missed by a check. */
export const PLATFORM_PERMISSION_PREFIX = 'platform:';

/** Whether a permission string belongs to the platform tier. */
export function isPlatformPermission(permission: string): boolean {
  return permission.startsWith(PLATFORM_PERMISSION_PREFIX);
}

/**
 * Whether a principal holds a platform permission.
 *
 * Exact match only. `hasPermission` is NOT used here on purpose: it resolves `'*'` and prefix
 * wildcards, and both would defeat the tier. A tenant administrator holding `'*'` must not reach a
 * platform right, and neither must a role that somehow acquired `platform:*`.
 */
export function hasPlatformPermission(
  userPermissions: readonly string[] | undefined | null,
  required: PlatformPermission,
): boolean {
  return Boolean(userPermissions?.includes(required));
}
