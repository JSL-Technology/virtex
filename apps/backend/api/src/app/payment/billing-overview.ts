import type { Organization } from '../organizations/entities/organization.entity';
import { SaasService } from '../saas/saas.service';
import { minorUnitFactor } from '../saas/saas.config';
import type { BillingManager, BillingOverview } from './payment-gateway.port';

/**
 * The billing overview as this product's own records have it, with nothing read from a provider.
 *
 * What the simulated provider shows, what a provider's overview falls back to when it cannot be
 * reached, and what a company billed through its parent is shown: the plan and the standing, never
 * a card or a portal that are not its own.
 */
export function overviewFromRecord(
  organization: Pick<Organization, 'plan' | 'country' | 'subscriptionStatus' | 'subscriptionPeriodEnd'>,
  managedBy: BillingManager,
  billedThrough: BillingOverview['billedThrough'] = null,
): BillingOverview {
  const currency = SaasService.currencyForCountry(organization.country ?? undefined);
  return {
    plan: organization.plan
      ? {
          slug: organization.plan.slug,
          name: organization.plan.name,
          monthlyPrice: SaasService.priceFor(organization.plan.slug, currency) ?? organization.plan.monthlyPrice ?? null,
          currency,
          minorUnits: minorUnitFactor(currency),
        }
      : null,
    subscription: organization.subscriptionStatus
      ? {
          status: organization.subscriptionStatus,
          currentPeriodEnd: organization.subscriptionPeriodEnd
            ? new Date(organization.subscriptionPeriodEnd).toISOString()
            : null,
          cancelAtPeriodEnd: false,
          managedBy,
        }
      : null,
    paymentMethod: null,
    billedThrough,
  };
}
