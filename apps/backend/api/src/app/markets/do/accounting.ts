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
};
