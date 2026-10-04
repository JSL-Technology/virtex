import { EntityManager } from 'typeorm';
import { OrganizationSubsidiary } from '../entities/organization-subsidiary.entity';

/**
 * Whether two companies belong to one corporate group.
 *
 * ## One fact, one table
 *
 * The parent–subsidiary relationship used to be stored twice: `organization_subsidiaries`, which
 * «Estructura empresarial» writes and consolidation reads, and `organization_group_members`, which
 * intercompany read to authorise posting into another company's books — and which nothing in the
 * product ever wrote. So a subsidiary created through the interface could never receive an
 * intercompany transaction: the authorisation consulted a table that stayed empty. The second
 * table is gone; this is the one question other modules may ask of the first, published here so
 * they ask it without reaching into the organizations module's entities.
 *
 * Two companies are in one group when one is a subsidiary of the other, or when both are
 * subsidiaries of the same parent (siblings) — the relationships under which NetSuite OneWorld and
 * SAP allow intercompany postings. A relationship whose control has ended (`control_ended_on` in
 * the past) no longer counts: a divested company is a third party.
 */
export async function inSameCorporateGroup(manager: EntityManager, a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const today = new Date().toISOString().slice(0, 10);
  const row = await manager
    .getRepository(OrganizationSubsidiary)
    .createQueryBuilder('link')
    .select('1')
    .where(
      `(
        (link.parentOrganizationId = :a AND link.subsidiaryOrganizationId = :b)
        OR (link.parentOrganizationId = :b AND link.subsidiaryOrganizationId = :a)
        OR (link.subsidiaryOrganizationId = :a AND link.parentOrganizationId IN (
              SELECT sibling.parent_organization_id FROM organization_subsidiaries sibling
               WHERE sibling.subsidiary_organization_id = :b
                 AND (sibling.control_ended_on IS NULL OR sibling.control_ended_on > :today)))
      )`,
      { a, b, today },
    )
    .andWhere('(link.controlEndedOn IS NULL OR link.controlEndedOn > :today)', { today })
    .limit(1)
    .getRawOne();
  return !!row;
}
