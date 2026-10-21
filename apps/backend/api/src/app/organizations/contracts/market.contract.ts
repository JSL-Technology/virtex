import { EntityManager } from 'typeorm';
import { Organization } from '../entities/organization.entity';
import { organizationBaseCurrency } from './base-currency.contract';

/**
 * The market a company works in, as text written for it must know it: its country, the language its
 * books are kept in, and their currency. What an assistant needs so that it writes for a company in
 * Texas as it would for one in Santo Domingo — in each one's own terms, and assuming neither.
 */
export interface OrganizationMarket {
  /** ISO 3166-1 alpha-2, or null when the company has not stated one. */
  country: string | null;
  /** `es`, `en`, `pt`…, or null when not set. */
  booksLanguage: string | null;
  /** ISO 4217. */
  baseCurrency: string;
}

export async function organizationMarket(manager: EntityManager, organizationId: string): Promise<OrganizationMarket> {
  const organization = await manager.findOne(Organization, {
    where: { id: organizationId },
    select: ['id', 'country', 'booksLanguage'],
  });
  return {
    country: organization?.country ? organization.country.toUpperCase() : null,
    booksLanguage: organization?.booksLanguage ?? null,
    baseCurrency: await organizationBaseCurrency(manager, organizationId),
  };
}
