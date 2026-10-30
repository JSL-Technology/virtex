import type { RegionalFormat } from '@virteex/shared/types';

/**
 * The currency a tenant keeps its books in, as the locale context needs it (QA A-12).
 *
 * The session told the browser the tenant's currency from `organization.currency` — a field the
 * organization entity does not have. Every tenant was therefore sent `USD`, and every amount the
 * client formatted without an explicit code (dashboard KPIs, new purchase orders, price lists…)
 * read as dollars in a Dominican-peso company. The functional currency lives in the tenant's
 * settings; the organizations module answers through this port so `i18n` (plataforma) does not
 * import an identity module.
 */
export abstract class TenantCurrencyPort {
  /** The tenant's functional (books) currency, or `null` when it has none configured. */
  abstract functionalCurrency(organizationId: string): Promise<string | null>;

  /**
   * How the company writes dates and numbers for everyone, or `null` when it left all of it to
   * the locale. Asked through the same port, and on the same response, as the currency: both are
   * the tenant's formatting defaults.
   */
  abstract regionalFormat(organizationId: string): Promise<RegionalFormat | null>;
}
