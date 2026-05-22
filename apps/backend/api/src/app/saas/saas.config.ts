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
  monthlyPriceIdVar: string; // Name of ENV var
  limits: PlanLimitConfig[];
}

export const SAAS_CONFIG = {
    get GRACE_PERIOD_DAYS() { return parseInt(process.env.SAAS_GRACE_PERIOD_DAYS || '5', 10); }
};

export const SAAS_PLANS: PlanConfig[] = [
  {
    slug: 'starter',
    name: 'Starter',
    monthlyPriceIdVar: 'STRIPE_PRICE_STARTER',
    limits: [
      { resource: SaasResource.INVOICES, limit: 10, period: 'monthly', allowOverage: false },
      { resource: SaasResource.USERS, limit: 2, period: 'lifetime', allowOverage: false }
    ]
  },
  {
    slug: 'pro',
    name: 'Professional',
    monthlyPriceIdVar: 'STRIPE_PRICE_PRO',
    limits: [
      { resource: SaasResource.INVOICES, limit: 100, period: 'monthly', allowOverage: true },
      { resource: SaasResource.USERS, limit: 10, period: 'lifetime', allowOverage: false }
    ]
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    monthlyPriceIdVar: 'STRIPE_PRICE_ENTERPRISE',
    limits: [
      { resource: SaasResource.INVOICES, limit: -1, period: 'monthly', allowOverage: true },
      { resource: SaasResource.USERS, limit: -1, period: 'lifetime', allowOverage: true }
    ]
  }
];
