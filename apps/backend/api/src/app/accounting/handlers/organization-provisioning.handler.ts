import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { TenantBookkeepingProvisioner } from '../provisioning/tenant-bookkeeping.provisioner';
import { Organization } from '../../organizations/entities/organization.entity';
import { findCountryProfile } from '../../localization/fiscal/country-profiles';

/** Payload emitted by OrganizationsService when an organization is created. */
export interface OrganizationCreatedEvent {
  organizationId: string;
  /** The country whose chart of accounts and fiscal setup should be applied. */
  country: string;
}

/**
 * Initialises bookkeeping for a newly created organization.
 *
 * ## Why this is a handler and not a direct call from invoices
 *
 * `InvoicesService` used to inject `TenantBookkeepingProvisioner` and call `invoicingGaps()`
 * on every invoice creation — checking whether the org's chart of accounts was configured.
 * That combined two unrelated responsibilities: issuing a document and verifying that the
 * accounting was set up correctly.
 *
 * The validation (`invoicingGaps`) is a legitimate pre-issuance check and stays in
 * `InvoicesService`. The *initialization* of bookkeeping now lives here, triggered once when
 * the organization is created, not on every invoice.
 *
 * ## Note on OrganizationsModule ↔ AccountingModule cycle
 *
 * This handler breaks the need for `InvoicesModule → AccountingModule → TenantBookkeepingProvisioner`
 * for initialization purposes. The remaining cycle between `OrganizationsModule` and
 * `LocalizationModule` (for transactional `applyFiscalPackage`) requires a
 * `LocalizationProvisioningPort` leaf module — a separate architectural work item.
 */
@Injectable()
export class OrganizationProvisioningHandler {
  private readonly logger = new Logger(OrganizationProvisioningHandler.name);

  constructor(
    private readonly bookkeeping: TenantBookkeepingProvisioner,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent('organization.created')
  async onOrganizationCreated(event: OrganizationCreatedEvent): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const org = await manager.findOneBy(Organization, { id: event.organizationId });
        if (!org) return;
        const profile = findCountryProfile(event.country);
        const baseCurrency = profile?.currency ?? 'USD';
        await this.bookkeeping.provision(org, baseCurrency, manager);
      });
      this.logger.log(`Contabilidad provisionada para la organización ${event.organizationId}.`);
    } catch (error) {
      this.logger.error(
        `Error al provisionar contabilidad para ${event.organizationId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
