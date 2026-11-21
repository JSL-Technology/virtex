// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketAccounting } from '../contracts';

/**
 * Colombia: what the market adds to the neutral starting plan. Every name is a starting point a local
 * accountant confirms: it names the institution an account is remitted to, which is a legal fact of
 * the country.
 */
export const accounting: MarketAccounting = {
  statutoryPlanRequired: 'Colombia exige el Plan Único de Cuentas (Decreto 2650). Importa el PUC oficial antes de reportar a la DIAN.',
  segments: null,
  payrollAccounts: {
    pension: 'Aportes a Fondos de Pensiones por Pagar',
    health: 'Aportes a EPS por Pagar',
    otherContributions: 'Aportes ARL y Parafiscales por Pagar',
    incomeTaxWithheld: 'Retención en la Fuente por Salarios por Pagar',
    employerContributions: 'Aportes Patronales (Seguridad Social y Parafiscales)',
  },
  exciseTaxAccount: 'Impuesto Nacional al Consumo por Pagar',
  serviceChargeAccount: null,
  fiscalGroupingCodes: null,
  exclusiveTerms: [/\bEPS\b/, /\bARL\b/, /Parafiscales/, /Impuesto Nacional al Consumo/],
};
