// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketAccounting } from '../contracts';

/**
 * Costa Rica: what the market adds to the neutral starting plan. Every name is a starting point a local
 * accountant confirms: it names the institution an account is remitted to, which is a legal fact of
 * the country.
 */
export const accounting: MarketAccounting = {
  statutoryPlanRequired: null,
  segments: null,
  payrollAccounts: null,
  exciseTaxAccount: null,
  // The 10 % service charge on restaurant bills belongs to the staff, not to Hacienda.
  serviceChargeAccount: 'Cargo por Servicio (10 %) por Pagar',
  fiscalGroupingCodes: null,
  exclusiveTerms: [],
  inflationAccounting: null,
  officialExchangeRates: {
    publisher: 'Banco Central de Costa Rica',
    quoteCurrency: 'CRC',
    legalBasis: 'Tipo de cambio de referencia publicado por el Banco Central de Costa Rica.',
    feed: null,
  },
};
