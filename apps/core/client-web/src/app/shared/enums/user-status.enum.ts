import type { UserStatusValue } from '@virteex/shared/types';

/**
 * Account status values.
 *
 * These MUST be uppercase: they are the literal strings the backend persists and compares
 * against (`UserStatus` in user.entity.ts, a Postgres enum column).
 *
 * They were previously lowercase ('active', 'pending', ...), which silently broke two things:
 *   - every `user.status === UserStatus.ACTIVE` comparison evaluated to false, because the API
 *     returns 'ACTIVE';
 *   - the members-list status filter sent `?status=active`, which the backend compared against
 *     the enum column and matched nothing, so filtering by any status returned an empty list.
 *
 * `satisfies Record<..., UserStatusValue>` ties the values to the shared contract, so they can no
 * longer drift from the backend without failing to compile.
 */
export const UserStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  ARCHIVED: 'ARCHIVED',
  BLOCKED: 'BLOCKED',
} as const satisfies Record<string, UserStatusValue>;

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
