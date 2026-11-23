// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketAccounting } from '../contracts';

/**
 * Nicaragua: what the market adds to the neutral starting plan. Every name is a starting point a local
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
  officialExchangeRates: {
    publisher: 'Banco Central de Nicaragua',
    quoteCurrency: 'NIO',
    legalBasis: 'Tipo de cambio oficial publicado por el Banco Central de Nicaragua.',
    feed: null,
  },
  // No categories the product carries for this market: each company sets its own categories' rates.
  taxDepreciation: null,
};
