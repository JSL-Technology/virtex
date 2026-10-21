import { hasPermission } from '@virteex/shared/util-auth';

/** Anything that can run a parameterised query: a DataSource, an EntityManager, a QueryRunner. */
export interface Queryable {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

/**
 * What one person may do and see inside one company, read as it is NOW.
 *
 * The request pipeline builds this from the session; background work (a report written at night,
 * a notice about it) has no session, and must not fall back to "everything" — that is exactly how
 * a report written by the system ends up read by somebody who could not open its sources. This is
 * the same answer the session would give: the roles the person holds in this company (plus
 * platform-level roles), and the branches they are limited to (`null` = every branch).
 */
export interface MemberAccess {
  userId: string;
  /** Active and not suspended in this company. An inactive member holds nothing. */
  active: boolean;
  permissions: string[];
  /** Branch ids the person is limited to; `null` when they see every branch. */
  branches: string[] | null;
  language: string | null;
}

export async function loadMemberAccess(db: Queryable, organizationId: string, userId: string): Promise<MemberAccess> {
  const [members, branches] = (await Promise.all([
    db.query(
      `SELECT u.preferred_language AS language, r.permissions
         FROM users u
         JOIN user_organizations m ON m.user_id = u.id AND m.organization_id = $1 AND m.suspended_at IS NULL
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id AND (r.organization_id = $1 OR r.organization_id IS NULL)
        WHERE u.id = $2 AND u.status = 'ACTIVE'`,
      [organizationId, userId],
    ),
    db.query(`SELECT branch_id FROM user_branch_access WHERE organization_id = $1 AND user_id = $2`, [organizationId, userId]),
  ])) as [Array<{ language: string | null; permissions: string | null }>, Array<{ branch_id: string }>];

  if (!members.length) return { userId, active: false, permissions: [], branches: [], language: null };
  return {
    userId,
    active: true,
    permissions: [...new Set(members.flatMap((row) => splitPermissions(row.permissions)))],
    branches: branches.length ? branches.map((row) => row.branch_id) : null,
    language: members[0].language,
  };
}

/** Active members of a company, each with what they hold. Used to decide who may be told about something. */
export async function loadMembersAccess(db: Queryable, organizationId: string): Promise<MemberAccess[]> {
  const [members, branches] = (await Promise.all([
    db.query(
      `SELECT u.id, u.preferred_language AS language, r.permissions
         FROM users u
         JOIN user_organizations m ON m.user_id = u.id AND m.organization_id = $1 AND m.suspended_at IS NULL
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id AND (r.organization_id = $1 OR r.organization_id IS NULL)
        WHERE u.status = 'ACTIVE'`,
      [organizationId],
    ),
    db.query(`SELECT user_id, branch_id FROM user_branch_access WHERE organization_id = $1`, [organizationId]),
  ])) as [Array<{ id: string; language: string | null; permissions: string | null }>, Array<{ user_id: string; branch_id: string }>];

  const byUser = new Map<string, MemberAccess>();
  for (const row of members) {
    const entry = byUser.get(row.id) ?? { userId: row.id, active: true, permissions: [], branches: null, language: row.language };
    entry.permissions.push(...splitPermissions(row.permissions));
    byUser.set(row.id, entry);
  }
  for (const row of branches) {
    const entry = byUser.get(row.user_id);
    if (entry) entry.branches = [...(entry.branches ?? []), row.branch_id];
  }
  return [...byUser.values()].map((entry) => ({ ...entry, permissions: [...new Set(entry.permissions)] }));
}

/** Holds every one of `required` (an empty list is held by any active member). */
export function holdsAll(access: Pick<MemberAccess, 'active' | 'permissions'>, required: readonly string[]): boolean {
  if (!access.active) return false;
  return required.length === 0 || hasPermission(access.permissions, [...required]);
}

function splitPermissions(raw: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((permission) => permission.trim())
    .filter(Boolean);
}
