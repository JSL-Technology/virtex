import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LanguageCode, matchLanguage } from '@virteex/shared/types';

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  language: LanguageCode;
}

export interface DirectoryRole {
  id: string;
  name: string;
  isSystem: boolean;
}

const DEFAULT_LANGUAGE = 'es' as LanguageCode;

/**
 * Who exists in the company, from the workflow's point of view: the people and roles a task can be
 * assigned to, and the language each person reads.
 *
 * It reads the identity tables through the shared `DataSource` rather than importing the users
 * module, the same way the approval notifications do — the engine needs names and ids, not the
 * identity domain's behaviour, and depending on its internals would couple two modules that the
 * boundary rules keep apart. Every query is scoped by membership in the company, so a user of
 * another tenant is never offered, validated or notified.
 */
@Injectable()
export class WorkflowDirectoryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async users(organizationId: string, search?: string, ids?: readonly string[]): Promise<DirectoryUser[]> {
    const params: unknown[] = [organizationId];
    let filter = '';
    if (search?.trim()) {
      params.push(`%${search.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
      filter += ` AND (lower(u."firstName" || ' ' || u."lastName") LIKE $${params.length} OR lower(u.email) LIKE $${params.length})`;
    }
    if (ids) {
      if (ids.length === 0) return [];
      params.push(ids);
      filter += ` AND u.id = ANY($${params.length}::uuid[])`;
    }
    const rows: Array<{ id: string; first: string; last: string; email: string; language: string | null }> =
      await this.dataSource.query(
        `SELECT u.id, u."firstName" AS first, u."lastName" AS last, u.email, u.preferred_language AS language
           FROM users u
           JOIN user_organizations m ON m.user_id = u.id AND m.organization_id = $1 AND m.suspended_at IS NULL
          WHERE u.status = 'ACTIVE'${filter}
          ORDER BY u."firstName", u."lastName"
          LIMIT 200`,
        params,
      );
    return rows.map((row) => ({
      id: row.id,
      name: `${row.first ?? ''} ${row.last ?? ''}`.trim() || row.email,
      email: row.email,
      language: matchLanguage(row.language) ?? DEFAULT_LANGUAGE,
    }));
  }

  async roles(organizationId: string): Promise<DirectoryRole[]> {
    const rows: Array<{ id: string; name: string; is_system_role: boolean }> = await this.dataSource.query(
      `SELECT r.id, r.name, r.is_system_role
         FROM roles r
        WHERE r.organization_id = $1
        ORDER BY r.is_system_role DESC, r.name`,
      [organizationId],
    );
    return rows.map((row) => ({ id: row.id, name: row.name, isSystem: row.is_system_role }));
  }

  /** Active members holding a role, for notifying everyone a role-assigned task waits on. */
  async usersInRole(organizationId: string, roleId: string): Promise<DirectoryUser[]> {
    const rows: Array<{ id: string; first: string; last: string; email: string; language: string | null }> =
      await this.dataSource.query(
        `SELECT u.id, u."firstName" AS first, u."lastName" AS last, u.email, u.preferred_language AS language
           FROM users u
           JOIN user_organizations m ON m.user_id = u.id AND m.organization_id = $1 AND m.suspended_at IS NULL
           JOIN user_roles ur ON ur.user_id = u.id AND ur.role_id = $2
          WHERE u.status = 'ACTIVE'
          LIMIT 500`,
        [organizationId, roleId],
      );
    return rows.map((row) => ({
      id: row.id,
      name: `${row.first ?? ''} ${row.last ?? ''}`.trim() || row.email,
      email: row.email,
      language: matchLanguage(row.language) ?? DEFAULT_LANGUAGE,
    }));
  }

  /** Display names for a set of user ids (inbox, timeline). Unknown ids are simply absent. */
  async names(organizationId: string, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
    const unique = [...new Set([...ids].filter((id): id is string => !!id))];
    const users = await this.users(organizationId, undefined, unique);
    return new Map(users.map((user) => [user.id, user.name]));
  }

  async userIdSet(organizationId: string, ids: Iterable<string>): Promise<Set<string>> {
    const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    return new Set((await this.users(organizationId, undefined, unique)).map((user) => user.id));
  }

  async roleIdSet(organizationId: string): Promise<Set<string>> {
    return new Set((await this.roles(organizationId)).map((role) => role.id));
  }

  async userIdsWithPermission(organizationId: string, permission: string): Promise<string[]> {
    const rows: Array<{ id: string; permissions: string }> = await this.dataSource.query(
      `SELECT DISTINCT u.id, r.permissions
         FROM users u
         JOIN user_organizations m ON m.user_id = u.id AND m.organization_id = $1 AND m.suspended_at IS NULL
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
        WHERE u.status = 'ACTIVE'`,
      [organizationId],
    );
    return [
      ...new Set(
        rows
          .filter((row) => {
            const list = String(row.permissions ?? '').split(',').map((p) => p.trim());
            return list.includes(permission) || list.includes('*') || list.includes('*:*');
          })
          .map((row) => row.id),
      ),
    ];
  }
}

/**
 * Render `{{path}}` placeholders from a context. Values are stringified; objects become JSON;
 * unknown paths render empty. There is no expression language — a placeholder is a path, nothing
 * more — so a template can never execute anything.
 */
export function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g, (_, path: string) => {
    let current: unknown = context;
    for (const segment of path.split('.')) {
      if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
        return '';
      }
      current = (current as Record<string, unknown>)[segment];
    }
    if (current === undefined || current === null) return '';
    return typeof current === 'object' ? JSON.stringify(current) : String(current);
  });
}
