// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketAccounting } from '../contracts';

/**
 * Venezuela: what the market adds to the neutral starting plan. Every name is a starting point a local
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
  /**
   * Restated statements: BA VEN-NIF 2 of the Federación de Colegios de Contadores Públicos, with
   * the national consumer price index the Banco Central de Venezuela publishes, and IAS 29 for
   * companies that apply full IFRS. To be confirmed with a local accountant; the tax adjustment for
   * inflation of the income tax law is a different computation.
   */
  inflationAccounting: {
    series: {
      code: 'VE-BCV-INPC',
      country: 'VE',
      currency: 'VES',
      name: 'Índice Nacional de Precios al Consumidor (INPC)',
      publisher: 'Banco Central de Venezuela',
      legalBasis: 'BA VEN-NIF 2 de la FCCPV; NIC 29 para quienes aplican NIIF',
    },
    standard: 'BA VEN-NIF 2 · NIC 29',
    defaultPolicy: 'YEAR_END',
    restatementAccounts: [],
  },
  officialExchangeRates: {
    publisher: 'Banco Central de Venezuela',
    quoteCurrency: 'VES',
    legalBasis: 'Tipo de cambio oficial publicado por el Banco Central de Venezuela.',
    feed: null,
  },
};
