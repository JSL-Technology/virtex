import { User } from '../../users/entities/user.entity/user.entity';
import type { Organization } from '../../organizations/entities/organization.entity';

export interface SafeUser extends Partial<Omit<User, 'password' | 'twoFactorSecret'>> {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string;
  roles: any[];
  permissions: string[];
  organization?: Organization;
  isTwoFactorEnabled?: boolean;
}

export interface AuthenticatedUser extends SafeUser {
  isImpersonating?: boolean;
  originalUserId?: string;
  sessionId?: string;
}

/**
 * The minimum a service needs to act on behalf of a person: who they are, and where to address
 * them.
 *
 * Several services took `User` (the entity) or `AuthenticatedUser` (the request principal) when
 * they only ever read `id` and `email`. Those two types are not assignable to one another — the
 * principal is a `Partial` of the entity with a narrower `organizationId` — so every call site
 * that had one and needed the other either cast or failed to compile. Naming the actual
 * requirement makes both acceptable and documents what the service does with the argument.
 *
 * `security` is included as optional because the MFA services read it when it happens to be
 * loaded and fall back to a database read when it is not — which is the behaviour that keeps a
 * stale secret from ever being trusted.
 */
export type UserIdentity = Pick<User, 'id' | 'email'> & Pick<Partial<User>, 'security'>;

/**
 * Whoever is acting, and the tenant they are acting in.
 *
 * The narrow contract for the many services that take a "user" only to scope a query by
 * organization. They previously took the `User` entity, whose `organizationId` is `string | null`
 * — so the query was typed as possibly-untenanted, which for a multi-tenant product is the one
 * thing it must never be.
 */
export type TenantPrincipal = { id: string; organizationId: string };
