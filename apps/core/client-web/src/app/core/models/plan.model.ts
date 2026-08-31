export interface PlanLimit {
  id: string;
  resource: string;
  limit: number;
  period: 'monthly' | 'lifetime';
}

export interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string;
  /**
   * Amount in the smallest unit of `currency` — and the amount that will actually be charged.
   * It used to be typed and treated as "USD cents" regardless of the market.
   */
  monthlyPrice: number;
  /** ISO 4217 the plan is quoted and billed in for the requested country. */
  currency: string;
  /** Minor units per unit of `currency`: 1 for CLP and PYG, 100 for the rest. */
  minorUnits: number;
  /**
   * The yearly amount in the same currency and units, or null when the plan has no annual price.
   *
   * Published by the server rather than derived here: an annual figure the checkout cannot charge
   * is the same defect as a local currency that is billed in dollars.
   */
  annualPrice: number | null;
  /** True only when both a Stripe annual Price and an amount for this currency exist. */
  annualBillingAvailable: boolean;
  trialPeriodDays: number | null;
  limits: PlanLimit[];
  features?: { featureKey: string; isEnabled: boolean }[];
}

/** Monthly or annual, as the server names them. */
export type BillingPeriod = 'monthly' | 'annual';

/**
 * Currencies with no minor unit. Mirrors the server's list; an amount in one of these is already
 * a whole unit, so dividing it by 100 shows a hundredth of the real price.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG',
  'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** Minor units per unit of `currency`, for amounts that did not arrive with the field. */
export function minorUnitFactorFor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has((currency ?? '').toUpperCase()) ? 1 : 100;
}

/** Render an amount the way its own market writes it. */
export function formatPlanPrice(
  plan: Pick<Plan, 'monthlyPrice' | 'annualPrice' | 'currency' | 'minorUnits'>,
  locale: string,
  period: BillingPeriod = 'monthly',
): string {
  const factor = plan.minorUnits || 100;
  const minorUnits = period === 'annual' ? (plan.annualPrice ?? 0) : (plan.monthlyPrice ?? 0);
  const amount = minorUnits / factor;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: plan.currency,
      // Zero-decimal currencies must not be shown with cents they do not have.
      maximumFractionDigits: factor === 1 ? 0 : 2,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    // An unknown currency code must not blank the price card.
    return `${plan.currency} ${amount}`;
  }
}

/**
 * How much a year of the annual price saves against twelve monthly ones, as a whole percentage.
 * Returns null when the plan has no annual price, or when annual is not actually cheaper.
 */
export function annualSavingPercent(
  plan: Pick<Plan, 'monthlyPrice' | 'annualPrice'>,
): number | null {
  if (!plan.annualPrice || !plan.monthlyPrice) return null;
  const twelveMonths = plan.monthlyPrice * 12;
  if (plan.annualPrice >= twelveMonths) return null;
  return Math.round(((twelveMonths - plan.annualPrice) / twelveMonths) * 100);
}
