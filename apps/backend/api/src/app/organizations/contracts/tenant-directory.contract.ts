import { EntityManager } from 'typeorm';
import { Organization } from '../entities/organization.entity';

/**
 * Every tenant's id, for platform jobs that act for all of them one at a time.
 *
 * A scheduled job has no request and no signed-in user, so it cannot read tenant data until it
 * knows whose data to read. This is the one question it may ask without a tenant context:
 * `organizations` is the directory of tenants, not a tenant's own table. Each id is then meant to
 * be processed inside `runAsTenantJob`, never across tenants at once.
 */
export async function allOrganizationIds(manager: EntityManager): Promise<string[]> {
  const rows = await manager.getRepository(Organization).find({ select: { id: true }, order: { createdAt: 'ASC' } });
  return rows.map((row) => row.id);
}
