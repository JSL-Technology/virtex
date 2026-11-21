import type { MarketAccounting } from '../contracts';

/** A market that adds nothing of its own to the starting plan: the neutral names, the default shape. */
export const NEUTRAL_ACCOUNTING: MarketAccounting = {
  statutoryPlanRequired: null,
  segments: null,
  payrollAccounts: null,
  exciseTaxAccount: null,
  serviceChargeAccount: null,
  fiscalGroupingCodes: null,
  exclusiveTerms: [],
};
