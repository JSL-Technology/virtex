import { SaasResource } from './enums/saas-resource.enum';

export interface PlanLimitConfig {
  resource: SaasResource;
  limit: number;
  period: 'monthly' | 'lifetime';
  allowOverage?: boolean;
}

export interface PlanConfig {
  slug: string;
  name: string;
  description: string;
  monthlyPriceIdVar: string; // Name of ENV var
  monthlyPrice: number; // Display price in USD cents
  trialPeriodDays?: number; // Optional free-trial length; omit/0 = charge immediately
  limits: PlanLimitConfig[];
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
    monthlyPrice: 900,
    limits: [
      { resource: SaasResource.INVOICES, limit: 10, period: 'monthly', allowOverage: false },
      { resource: SaasResource.USERS, limit: 2, period: 'lifetime', allowOverage: false },
      { resource: SaasResource.CUSTOMERS, limit: 100, period: 'lifetime', allowOverage: false },
      { resource: SaasResource.SUPPLIERS, limit: 50, period: 'lifetime', allowOverage: false },
      { resource: SaasResource.JOURNAL_ENTRIES, limit: 200, period: 'monthly', allowOverage: false },
      // Group consolidation is not part of this tier. A zero limit refuses the first one.
      { resource: SaasResource.SUBSIDIARIES, limit: 0, period: 'lifetime', allowOverage: false }
    ]
  },
  {
    slug: 'pro',
    name: 'Professional',
    description: 'Para empresas en crecimiento con necesidades avanzadas',
    monthlyPriceIdVar: 'STRIPE_PRICE_PRO',
    monthlyPrice: 4900,
    limits: [
      { resource: SaasResource.INVOICES, limit: 100, period: 'monthly', allowOverage: true },
      { resource: SaasResource.USERS, limit: 10, period: 'lifetime', allowOverage: false },
      { resource: SaasResource.CUSTOMERS, limit: 2_000, period: 'lifetime', allowOverage: true },
      { resource: SaasResource.SUPPLIERS, limit: 1_000, period: 'lifetime', allowOverage: true },
      { resource: SaasResource.JOURNAL_ENTRIES, limit: 5_000, period: 'monthly', allowOverage: true },
      { resource: SaasResource.SUBSIDIARIES, limit: 3, period: 'lifetime', allowOverage: false }
    ]
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    description: 'Solución completa sin límites para grandes organizaciones',
    monthlyPriceIdVar: 'STRIPE_PRICE_ENTERPRISE',
    monthlyPrice: 19900,
    limits: [
      { resource: SaasResource.INVOICES, limit: -1, period: 'monthly', allowOverage: true },
      { resource: SaasResource.USERS, limit: -1, period: 'lifetime', allowOverage: true },
      { resource: SaasResource.CUSTOMERS, limit: -1, period: 'lifetime', allowOverage: true },
      { resource: SaasResource.SUPPLIERS, limit: -1, period: 'lifetime', allowOverage: true },
      { resource: SaasResource.JOURNAL_ENTRIES, limit: -1, period: 'monthly', allowOverage: true },
      { resource: SaasResource.SUBSIDIARIES, limit: -1, period: 'lifetime', allowOverage: true }
    ]
  }
];
