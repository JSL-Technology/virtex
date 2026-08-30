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
  trialPeriodDays: number | null;
  limits: PlanLimit[];
  features?: { featureKey: string; isEnabled: boolean }[];
}

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
export function formatPlanPrice(plan: Pick<Plan, 'monthlyPrice' | 'currency' | 'minorUnits'>, locale: string): string {
  const factor = plan.minorUnits || 100;
  const amount = (plan.monthlyPrice ?? 0) / factor;
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
