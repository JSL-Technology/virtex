// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketAccounting } from '../contracts';

/**
 * United States: what the market adds to the neutral starting plan. Every name is a starting point a local
 * accountant confirms: it names the institution an account is remitted to, which is a legal fact of
 * the country.
 */
export const accounting: MarketAccounting = {
  statutoryPlanRequired: null,
  segments: null,
  payrollAccounts: null,
  exciseTaxAccount: null,
  serviceChargeAccount: null,
  fiscalGroupingCodes: null,
  exclusiveTerms: [],
  inflationAccounting: null,
  // The dollar is the market's currency: nothing it books needs a published conversion of its own.
  officialExchangeRates: null,
};
