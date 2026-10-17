import { DataSource } from 'typeorm';
import { hasPermission } from '@virteex/shared/util-auth';

export interface Recipient {
  id: string;
  language: string | null;
}

/**
 * Active, unsuspended members of a company who hold a permission there, optionally excluding one
 * person (whoever caused the notice). Roles are read as they are now, so a permission withdrawn a
 * minute ago is no longer notified.
 */
export async function membersWithPermission(
  dataSource: DataSource,
  organizationId: string,
  permission: string,
  excludeUserId: string | null = null,
): Promise<Recipient[]> {
  const rows: { id: string; language: string | null; permissions: string | null }[] = await dataSource.query(
    `SELECT u.id, u.preferred_language AS language, r.permissions
       FROM users u
       JOIN user_organizations m ON m.user_id = u.id AND m.organization_id = $1 AND m.suspended_at IS NULL
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND (r.organization_id = $1 OR r.organization_id IS NULL)
      WHERE u.status = 'ACTIVE' AND ($2::uuid IS NULL OR u.id <> $2::uuid)`,
    [organizationId, excludeUserId],
  );
  const byUser = new Map<string, { language: string | null; permissions: string[] }>();
  for (const row of rows) {
    const entry = byUser.get(row.id) ?? { language: row.language, permissions: [] };
    entry.permissions.push(...(row.permissions ?? '').split(',').map((p) => p.trim()).filter(Boolean));
    byUser.set(row.id, entry);
  }
  return [...byUser.entries()]
    .filter(([, entry]) => hasPermission(entry.permissions, [permission]))
    .map(([id, entry]) => ({ id, language: entry.language }));
}
