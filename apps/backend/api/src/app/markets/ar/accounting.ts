// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketAccounting } from '../contracts';

/**
 * Argentina: what the market adds to the neutral starting plan. Every name is a starting point a local
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
  // The restatement of capital is kept in an account of its own (RT 8/RT 9 present capital at its
  // nominal value, «Ajuste de capital» beside it); no other market's plan carries the name.
  exclusiveTerms: [/Ajuste de Capital/i],
  /**
   * Restated statements in constant currency: RT 6 of the FACPCE, required again for periods ending
   * from 1 July 2018 (Resolución JG 539/18), and IAS 29 for companies that apply IFRS. The index is
   * the series the FACPCE publishes for it — the INDEC's wholesale index (IPIM) up to December
   * 2016 and its national consumer index (IPC) from January 2017. To be confirmed with a local
   * accountant; the tax adjustment for inflation (Ley 27.430) is a different computation.
   */
  inflationAccounting: {
    series: {
      code: 'AR-FACPCE',
      country: 'AR',
      currency: 'ARS',
      name: 'Serie de índices FACPCE para la reexpresión en moneda homogénea',
      publisher: 'FACPCE, con el IPIM (hasta diciembre de 2016) y el IPC nacional (desde enero de 2017) del INDEC',
      legalBasis: 'RT 6 y Resolución JG 539/18 de la FACPCE; NIC 29 para quienes aplican NIIF',
    },
    standard: 'RT 6 (FACPCE) · NIC 29',
    defaultPolicy: 'YEAR_END',
    restatementAccounts: [{ sourceCode: '3100', code: '3110', name: 'Ajuste de Capital' }],
  },
};
