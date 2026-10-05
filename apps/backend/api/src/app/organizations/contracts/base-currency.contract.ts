import { EntityManager } from 'typeorm';
import { OrganizationSettings } from '../entities/organization-settings.entity';

/** The currency a company keeps its books in — what a report with no currency of its own is in. */
export async function organizationBaseCurrency(manager: EntityManager, organizationId: string): Promise<string> {
  const settings = await manager.findOne(OrganizationSettings, {
    where: { organizationId },
    select: { organizationId: true, baseCurrency: true },
  });
  return settings?.baseCurrency ?? 'USD';
}
