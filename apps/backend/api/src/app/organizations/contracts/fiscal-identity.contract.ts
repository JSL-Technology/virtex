import { EntityManager } from 'typeorm';
import { Organization } from '../entities/organization.entity';

/** Who the company is before a tax authority: its market, its identifier and what kind of taxpayer. */
export interface OrganizationFiscalIdentity {
  /** ISO 3166-1 alpha-2, or null for a company that has not stated one. */
  country: string | null;
  /** The identifier as recorded (RNC, RFC, NIT, RUC, CUIT…), or null when it has none yet. */
  taxId: string | null;
  /** `company` or `individual`, where the market tells them apart. */
  taxpayerKind: string | null;
  legalName: string | null;
  /** The registered address, as the printed representation of a comprobante states it. */
  address: string | null;
  city: string | null;
}

/**
 * The company's fiscal identity, read inside the caller's transaction when one is given.
 *
 * Electronic invoicing needs it to tie a signing certificate to the company in any market, and
 * reading the organization's row directly from another module couples it to how that row is laid out.
 */
export async function organizationFiscalIdentity(
  manager: EntityManager,
  organizationId: string,
): Promise<OrganizationFiscalIdentity | null> {
  const organization = await manager.findOne(Organization, {
    where: { id: organizationId },
    select: ['id', 'country', 'taxId', 'taxpayerKind', 'legalName', 'address', 'city'],
  });
  if (!organization) return null;
  return {
    country: organization.country ? organization.country.toUpperCase() : null,
    taxId: organization.taxId ?? null,
    taxpayerKind: organization.taxpayerKind ?? null,
    legalName: organization.legalName ?? null,
    address: organization.address ?? null,
    city: organization.city ?? null,
  };
}
