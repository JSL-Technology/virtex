import { EntityManager } from 'typeorm';
import { OrganizationSettings } from '../entities/organization-settings.entity';

/** The company's default posting accounts, as a module that posts a subledger needs them. */
export interface OrganizationPostingAccounts {
  baseCurrency: string | null;
  cashId: string | null;
  bankId: string | null;
  salesRevenueId: string | null;
  serviceRevenueId: string | null;
  salesTaxId: string | null;
  costOfGoodsSoldId: string | null;
  inventoryId: string | null;
}

/**
 * Read inside the caller's transaction. Reading the settings row from another module coupled it to
 * the row's layout; this names only what a posting asks for.
 */
export async function organizationPostingAccounts(
  manager: EntityManager,
  organizationId: string,
): Promise<OrganizationPostingAccounts | null> {
  const settings = await manager.findOne(OrganizationSettings, { where: { organizationId } });
  if (!settings) return null;
  return {
    baseCurrency: settings.baseCurrency ?? null,
    cashId: settings.defaultCashId ?? null,
    bankId: settings.defaultBankId ?? null,
    salesRevenueId: settings.defaultSalesRevenueId ?? null,
    serviceRevenueId: settings.defaultServiceRevenueId ?? null,
    salesTaxId: settings.defaultSalesTaxId ?? null,
    costOfGoodsSoldId: settings.defaultCostOfGoodsSoldId ?? null,
    inventoryId: settings.defaultInventoryId ?? null,
  };
}
