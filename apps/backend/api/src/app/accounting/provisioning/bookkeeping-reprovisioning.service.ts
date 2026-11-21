import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { OrganizationSettings } from '../../organizations/entities/organization-settings.entity';
import { baseCurrencyOf } from '../../markets';
import { TenantBookkeepingProvisioner } from './tenant-bookkeeping.provisioner';

/**
 * Re-running a company's operational bookkeeping, on request (FIN-AC-06).
 *
 * The event that provisions a company runs once, after the organization is committed and outside
 * any request; when it fails — a transient database error, a half-applied schema — the company can
 * sign in and cannot post, and the handler's log says to reprovision it. That lived in the
 * controller, transaction and all; it is a business operation and belongs here, where it can be
 * reused and tested without HTTP.
 *
 * Every step the provisioner runs is idempotent: a healthy company is unchanged, one missing a
 * journal, a sequence, the fiscal calendar or the default warehouse gets it. What still stops it
 * from invoicing comes back — notably a chart of accounts, which the country's fiscal package
 * applies rather than this.
 */
@Injectable()
export class BookkeepingReprovisioningService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly provisioner: TenantBookkeepingProvisioner,
  ) {}

  async reprovision(organizationId: string): Promise<{ gaps: string[] }> {
    return this.dataSource.transaction(async (manager) => {
      const organization = await manager.findOneByOrFail(Organization, { id: organizationId });
      const settings = await manager.findOne(OrganizationSettings, { where: { organizationId } });
      // The currency the books are already kept in; for a company whose settings never got
      // written, its market's — the same rule signup applies.
      const baseCurrency = settings?.baseCurrency ?? baseCurrencyOf(organization.country);
      await this.provisioner.provision(organization, baseCurrency, manager);
      return { gaps: await this.provisioner.invoicingGaps(organizationId, manager) };
    });
  }
}
