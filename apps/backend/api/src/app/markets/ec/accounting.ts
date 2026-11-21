// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketAccounting } from '../contracts';

/**
 * Ecuador: what the market adds to the neutral starting plan. Every name is a starting point a local
 * accountant confirms: it names the institution an account is remitted to, which is a legal fact of
 * the country.
 */
export const accounting: MarketAccounting = {
  statutoryPlanRequired: 'Ecuador exige el catálogo de cuentas de la Superintendencia de Compañías para las sociedades sujetas a su control.',
  segments: null,
  payrollAccounts: null,
  exciseTaxAccount: 'ICE por Pagar',
  serviceChargeAccount: null,
  fiscalGroupingCodes: null,
  exclusiveTerms: [/\bICE\b/],
};
