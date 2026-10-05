import { EntityManager } from 'typeorm';
import { Organization } from '../entities/organization.entity';
import { fiscalDate, organizationTimeZone } from '../../shared/fiscal-clock';

/**
 * Today, as the company's books read it: the calendar date in its fiscal time zone.
 *
 * A document dated from the server clock in UTC is dated tomorrow for every tenant west of
 * Greenwich after its evening — and a document dated past a period close lands in a month already
 * reported. Every module that defaults a document's date to "today" asks here.
 */
export async function organizationToday(manager: EntityManager, organizationId: string): Promise<string> {
  const organization = await manager.findOne(Organization, {
    where: { id: organizationId },
    select: ['id', 'country', 'timezone'],
  });
  return fiscalDate(organizationTimeZone(organization));
}
