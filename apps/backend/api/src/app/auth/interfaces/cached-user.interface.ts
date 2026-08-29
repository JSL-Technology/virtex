import { UserStatus } from '../../users/entities/user.entity/user.entity';
import { Organization } from '../../organizations/entities/organization.entity';

/**
 * What the authentication hot path keeps in Redis.
 *
 * This used to be the whole `User` entity with its `security` relation attached, cached for
 * fifteen minutes on every authenticated request. That meant `passwordHash`, `twoFactorSecret`,
 * `backupCodes`, `passwordResetToken` and `emailChangeToken` all sat in a cache that has no
 * authentication and no TLS by default — so compromising Redis became equivalent to dumping the
 * `user_security` table, and the blast radius of the weakest component in the stack was the same
 * as that of the strongest.
 *
 * The projection below is everything the request pipeline actually reads: identity, tenant,
 * authorisation, and the two flags that gate a session. `tokenVersion` is the only field from
 * `user_security` that survives, because token invalidation is checked on every request — and a
 * version number reveals nothing on its own.
 *
 * Anything not here is a database read away, and the paths that need a secret (login, step-up,
 * 2FA verification) go to the database on purpose: they are not hot, and they are exactly the
 * paths where a stale value would be a security bug.
 */
export interface CachedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  organizationId: string | null;

  /** Flattened from every assigned role, so authorisation needs no joins on the hot path. */
  permissions: string[];

  /** Role names only. The permission set above is what guards actually evaluate. */
  roleNames: string[];

  /** Bumped on password change, role change, forced logout — invalidates every issued token. */
  tokenVersion: number;

  isTwoFactorEnabled: boolean;

  /** Tenant context. Kept because it is attached to the request principal on every call. */
  organization?: Organization;

  /** Every tenant the user may act in, for multi-organization access checks. */
  organizations?: Array<{ id: string; legalName: string }>;
}
