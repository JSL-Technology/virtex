import { EntityManager } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { FiscalRegion } from './entities/fiscal-region.entity';

/**
 * The provisioning surface OrganizationsModule uses from LocalizationModule.
 *
 * ## Why this exists
 *
 * `OrganizationsModule` imported the full `LocalizationModule` (via `forwardRef`) so that
 * `OrganizationsService.createSubsidiary()` could call `LocalizationService.findRegionByCountryCode()`
 * and `applyFiscalPackage()` inside the creation transaction. `LocalizationModule` in turn imported
 * `OrganizationsModule` for a single controller endpoint, creating a bidirectional cycle.
 *
 * This port narrows the contract to the two methods OrganizationsService actually needs.
 * `LocalizationProvisioningModule` (leaf) binds the token to `LocalizationService` and exports it.
 * `OrganizationsModule` imports the leaf instead of the full module.
 */
export abstract class LocalizationProvisioningPort {
  abstract findRegionByCountryCode(countryCode: string): Promise<FiscalRegion | null>;

  abstract applyFiscalPackage(
    organization: Organization,
    manager?: EntityManager,
  ): Promise<void>;
}
