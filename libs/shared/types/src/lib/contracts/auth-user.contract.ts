/**
 * THE contract for a user as returned by the API.
 *
 * ## Why this file exists
 *
 * The backend's `UserResponseDto` and the frontend's `User` interface were maintained
 * independently and had drifted apart. The DTO is serialised with
 * `excludeExtraneousValues: true`, so any field it does not declare is silently stripped from
 * the response — yet the frontend interface declared several of them as REQUIRED and the UI
 * read them:
 *
 *   - `user-management.page.ts` rendered `user.roles.map(r => r.name)`, so the members list
 *     always showed "Sin rol" and the edit dialog never preselected a role;
 *   - the profile screen could not display phone, job title or avatar, and saving the profile
 *     returned a payload without `phone`, so the UI blanked the field the user had just set.
 *
 * Nothing failed loudly: TypeScript was satisfied on both sides because each side was internally
 * consistent. The only durable fix is a single declaration both sides derive from, so adding a
 * field to one without the other becomes a compile error rather than a silent `undefined`.
 *
 * Backend: `UserResponseDto implements AuthUserContract` (its @Expose set is checked against it).
 * Frontend: `User extends AuthUserContract`.
 */

/** Status values a user account can hold. Mirrors the backend `UserStatus` enum. */
export type UserStatusValue = 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' | 'BLOCKED';

export interface RoleContract {
  id: string;
  name: string;
  description?: string | null;
  /** Effective permission strings. Supports prefix wildcards ('users:*') and the global '*'. */
  permissions: string[];
  isSystemRole: boolean;
}

/**
 * Organization data the client is allowed to see.
 *
 * `logoUrl`, `subscriptionStatus` and `gracePeriodEnd` exist as columns on the Organization
 * entity and are read by the UI (the sidebar logo and the subscription/grace-period banner), but
 * the response DTO never exposed them — so, like `roles` on the user, they arrived as `undefined`
 * and those features silently rendered nothing.
 *
 * Financial identifiers (`stripeCustomerId`, `stripeSubscriptionId`) are deliberately excluded:
 * the client never needs them and they are useful to an attacker enumerating billing accounts.
 */
export interface OrganizationContract {
  id: string;
  legalName: string;
  taxId?: string | null;
  logoUrl?: string | null;
  subscriptionStatus?: string | null;
  /** ISO-8601. Set when a lapsed subscription is inside its grace window. */
  gracePeriodEnd?: string | null;
}

export interface AuthUserContract {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatusValue;

  /** Roles assigned to the user. Always present — an empty array when the user has none. */
  roles: RoleContract[];

  /**
   * Flattened permissions derived from `roles`, computed server-side so the client never has to
   * re-derive them (and cannot disagree with the server about what they are).
   */
  permissions: string[];

  organizationId: string | null;
  /** The tenant the session is currently operating in. */
  organization: OrganizationContract | null;
  /**
   * Every tenant this user may switch into, resolved from the `user_organizations` join table.
   * Always contains at least the active organization. The company switcher renders this; it was
   * previously driven by a hardcoded mock list because the field was never exposed.
   */
  organizations: OrganizationContract[];

  // ---- Profile ----
  avatarUrl?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  preferredLanguage?: string | null;

  // ---- Account state ----
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  isTwoFactorEnabled: boolean;
  isOnline: boolean;
  lastActivity?: string | null;
  createdAt?: string | null;

  // ---- Impersonation context ----
  isImpersonating?: boolean;
  originalUserId?: string | null;
}

/**
 * Fields that must NEVER appear in a serialised user.
 *
 * Kept as a type-level assertion so a future edit that adds one of them to the contract fails to
 * compile instead of quietly shipping a credential to the browser.
 */
export type ForbiddenUserFields =
  | 'passwordHash'
  | 'twoFactorSecret'
  | 'pendingTwoFactorSecret'
  | 'backupCodes'
  | 'invitationToken'
  | 'passwordResetToken'
  | 'emailChangeToken'
  | 'security'
  | 'accessToken'
  | 'refreshToken';

// Compile-time guard: the contract and the forbidden list must not intersect.
type AssertNoSecrets<T> = Extract<keyof T, ForbiddenUserFields> extends never ? true : never;
export type _AuthUserContractHasNoSecrets = AssertNoSecrets<AuthUserContract>;
