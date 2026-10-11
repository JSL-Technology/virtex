/**
 * Which comprobantes a company issues where its market has two kinds — in the Dominican Republic,
 * traditional NCF (serie B) and electronic e-CF (serie E). See
 * `OrganizationSettings.fiscalEmissionMode`; invoicing reads it through this contract.
 */
export const FISCAL_EMISSION_MODES = ['BOTH', 'ELECTRONIC', 'TRADITIONAL'] as const;
export type FiscalEmissionMode = (typeof FISCAL_EMISSION_MODES)[number];
