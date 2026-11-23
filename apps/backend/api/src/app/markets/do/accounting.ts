// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketAccounting } from '../contracts';

/**
 * Dominican Republic: what the market adds to the neutral starting plan. Every name is a starting point a local
 * accountant confirms: it names the institution an account is remitted to, which is a legal fact of
 * the country.
 */
export const accounting: MarketAccounting = {
  statutoryPlanRequired: null,
  segments: null,
  payrollAccounts: {
    pension: 'AFP por Pagar (TSS)',
    health: 'SFS por Pagar (TSS)',
    otherContributions: 'SRL e INFOTEP por Pagar',
    incomeTaxWithheld: 'ISR de Empleados Retenido por Pagar',
    employerContributions: 'Aportes Patronales (TSS/INFOTEP)',
  },
  exciseTaxAccount: 'Impuesto Selectivo al Consumo por Pagar',
  // Ley 16-92, art. 228: the 10 % legal tip on hospitality services.
  serviceChargeAccount: 'Propina Legal por Pagar',
  fiscalGroupingCodes: null,
  exclusiveTerms: [/\bTSS\b/, /\bAFP\b/, /\bSFS\b/, /\bSRL\b/, /INFOTEP/, /Propina Legal/, /ITBIS/, /Selectivo/],
  inflationAccounting: null,
  officialExchangeRates: {
    publisher: 'Banco Central de la República Dominicana',
    quoteCurrency: 'DOP',
    legalBasis: 'Tasa de cambio de referencia del Banco Central, la que la DGII publica para fines fiscales.',
    feed: null,
  },
  // Ley 11-92 (Código Tributario), art. 287: three categories, each depreciated on what is left of
  // it at the close of the year. A starting point — verificar con contador local.
  taxDepreciation: {
    authority: 'DGII',
    categories: [
      { code: 'DO-1', nameKey: 'fixed_assets.tax_categories.do_1', method: 'DECLINING_BALANCE', annualRate: 0.05, legalBasis: 'Ley 11-92, art. 287, categoría 1' },
      { code: 'DO-2', nameKey: 'fixed_assets.tax_categories.do_2', method: 'DECLINING_BALANCE', annualRate: 0.25, legalBasis: 'Ley 11-92, art. 287, categoría 2' },
      { code: 'DO-3', nameKey: 'fixed_assets.tax_categories.do_3', method: 'DECLINING_BALANCE', annualRate: 0.15, legalBasis: 'Ley 11-92, art. 287, categoría 3' },
    ],
    caveat: 'fixed_assets.tax_categories.do_caveat',
  },
};
