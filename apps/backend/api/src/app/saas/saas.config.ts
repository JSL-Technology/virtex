import { SaasResource } from './enums/saas-resource.enum';
import { QuotaPeriod } from './enums/quota-period.enum';

export interface PlanLimitConfig {
  resource: SaasResource;
  limit: number;
  period: QuotaPeriod;
  allowOverage?: boolean;
}

/**
 * What a plan costs, per currency, in that currency's minor units.
 *
 * A single `monthlyPrice` integer documented as "USD cents" was the whole defect: the catalogue
 * endpoint relabelled it with the market's currency without converting it, the client divided it
 * by 100 and prefixed a dollar sign, and Stripe charged whatever `currency_options` said. Three
 * numbers, no two of which had to agree.
 *
 * The rule now is that a currency is only OFFERED if it appears here. Resolution of the market
 * currency, the amount shown on the plan card, and the `currency` handed to Checkout all read
 * this same map, so the price displayed is by construction the price charged. `verifyPriceCatalog`
 * additionally asserts at boot that every entry matches the Stripe Price it will be billed from.
 *
 * Adding a market currency is therefore a deliberate, two-sided act: add the amount here AND a
 * matching `currency_options` entry on the Stripe Price. Anything less and the market simply
 * continues to be quoted and charged in the base currency, which is honest, rather than quoted
 * locally and charged in dollars, which is not.
 */
export type PlanPriceTable = Readonly<Record<string, number>>;

/**
 * A capability a plan either grants or withholds.
 *
 * `PlanFeature`, `FeatureFlagGuard` and `@CheckFeature` all existed and none of them was ever
 * reached: `saas_plan_features` was empty after every boot because nothing seeded it, so
 * `checkFeature` answered `false` for everything and the guard was never applied to a route
 * anyway. The three plans therefore differed by six numbers and nothing else.
 *
 * The two flags below are deliberately NOT a new pricing decision. Each restates an intent the
 * plan configuration already expresses:
 *
 *   - `group_consolidation` mirrors the `SUBSIDIARIES` quota, which is already 0 on Starter.
 *     Without the flag a Starter tenant is blocked from CREATING a subsidiary but can still open
 *     the consolidation module, which is a worse experience than saying so.
 *   - `enterprise_sso` is per-tenant identity-provider configuration, on the tier the product
 *     itself calls Enterprise.
 *
 * Adding a flag here without also applying `@CheckFeature` to a route recreates the original
 * problem, so `saas-entitlements.spec.ts` asserts every declared key is one the product knows.
 */
export interface PlanFeatureConfig {
  featureKey: string;
  isEnabled: boolean;
}

/** Capability keys the product actually enforces. A flag outside this set meters nothing. */
export const SAAS_FEATURE_KEYS = ['group_consolidation', 'enterprise_sso'] as const;
export type SaasFeatureKey = (typeof SAAS_FEATURE_KEYS)[number];

export interface PlanConfig {
  slug: string;
  name: string;
  description: string;
  monthlyPriceIdVar: string; // Name of ENV var
  /**
   * Amounts per ISO 4217 currency, in minor units (or whole units for the zero-decimal
   * currencies — see `minorUnitFactor`). `SAAS_BASE_CURRENCY` must be one of the keys.
   */
  monthlyPrices: PlanPriceTable;
  trialPeriodDays?: number; // Optional free-trial length; omit/0 = charge immediately
  limits: PlanLimitConfig[];
  /** Every plan declares every key, so "missing" can never quietly mean "enabled". */
  features: PlanFeatureConfig[];
}

/**
 * Currencies that have no minor unit. Stripe expects their amounts as whole units, and dividing
 * them by 100 for display — which the plan card did unconditionally — understates the price a
 * hundredfold. CLP and PYG are the two that matter for this product's markets.
 */
const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG',
  'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** How many minor units make one unit of `currency`. 1 for zero-decimal currencies, else 100. */
export function minorUnitFactor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has((currency ?? '').toUpperCase()) ? 1 : 100;
}

export const SAAS_CONFIG = {
    get GRACE_PERIOD_DAYS() { return parseInt(process.env.SAAS_GRACE_PERIOD_DAYS || '5', 10); }
};

/**
 * Every plan declares a limit for every metered resource.
 *
 * `enforceLimit` returns early when a plan has no `PlanLimit` row for the resource it is asked
 * about — so a resource missing from a plan is unlimited on that plan, silently. That is the
 * failure mode this list has to avoid, and `saas-entitlements.spec.ts` asserts the completeness
 * rather than leaving it to review.
 */
export const SAAS_PLANS: PlanConfig[] = [
  {
    slug: 'starter',
    name: 'Starter',
    description: 'Ideal para equipos pequeños que empiezan',
    monthlyPriceIdVar: 'STRIPE_PRICE_STARTER',
    // Only USD is priced. Every market is therefore quoted AND charged in USD until a local
    // amount is added here together with its Stripe `currency_options` entry.
    monthlyPrices: { USD: 900 },
    limits: [
      { resource: SaasResource.INVOICES, limit: 10, period: QuotaPeriod.MONTHLY, allowOverage: false },
      { resource: SaasResource.USERS, limit: 2, period: QuotaPeriod.LIFETIME, allowOverage: false },
      { resource: SaasResource.CUSTOMERS, limit: 100, period: QuotaPeriod.LIFETIME, allowOverage: false },
      { resource: SaasResource.SUPPLIERS, limit: 50, period: QuotaPeriod.LIFETIME, allowOverage: false },
      { resource: SaasResource.JOURNAL_ENTRIES, limit: 200, period: QuotaPeriod.MONTHLY, allowOverage: false },
      // Group consolidation is not part of this tier. A zero limit refuses the first one.
      { resource: SaasResource.SUBSIDIARIES, limit: 0, period: QuotaPeriod.LIFETIME, allowOverage: false }
    ],
    features: [
      // Consistent with the SUBSIDIARIES limit of 0 above.
      { featureKey: 'group_consolidation', isEnabled: false },
      { featureKey: 'enterprise_sso', isEnabled: false },
    ]
  },
  {
    slug: 'pro',
    name: 'Professional',
    description: 'Para empresas en crecimiento con necesidades avanzadas',
    monthlyPriceIdVar: 'STRIPE_PRICE_PRO',
    monthlyPrices: { USD: 4900 },
    limits: [
      { resource: SaasResource.INVOICES, limit: 100, period: QuotaPeriod.MONTHLY, allowOverage: true },
      { resource: SaasResource.USERS, limit: 10, period: QuotaPeriod.LIFETIME, allowOverage: false },
      { resource: SaasResource.CUSTOMERS, limit: 2_000, period: QuotaPeriod.LIFETIME, allowOverage: true },
      { resource: SaasResource.SUPPLIERS, limit: 1_000, period: QuotaPeriod.LIFETIME, allowOverage: true },
      { resource: SaasResource.JOURNAL_ENTRIES, limit: 5_000, period: QuotaPeriod.MONTHLY, allowOverage: true },
      { resource: SaasResource.SUBSIDIARIES, limit: 3, period: QuotaPeriod.LIFETIME, allowOverage: false }
    ],
    features: [
      { featureKey: 'group_consolidation', isEnabled: true },
      { featureKey: 'enterprise_sso', isEnabled: false },
    ]
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    description: 'Solución completa sin límites para grandes organizaciones',
    monthlyPriceIdVar: 'STRIPE_PRICE_ENTERPRISE',
    monthlyPrices: { USD: 19900 },
    limits: [
      { resource: SaasResource.INVOICES, limit: -1, period: QuotaPeriod.MONTHLY, allowOverage: true },
      { resource: SaasResource.USERS, limit: -1, period: QuotaPeriod.LIFETIME, allowOverage: true },
      { resource: SaasResource.CUSTOMERS, limit: -1, period: QuotaPeriod.LIFETIME, allowOverage: true },
      { resource: SaasResource.SUPPLIERS, limit: -1, period: QuotaPeriod.LIFETIME, allowOverage: true },
      { resource: SaasResource.JOURNAL_ENTRIES, limit: -1, period: QuotaPeriod.MONTHLY, allowOverage: true },
      { resource: SaasResource.SUBSIDIARIES, limit: -1, period: QuotaPeriod.LIFETIME, allowOverage: true }
    ],
    features: [
      { featureKey: 'group_consolidation', isEnabled: true },
      { featureKey: 'enterprise_sso', isEnabled: true },
    ]
  }
];
