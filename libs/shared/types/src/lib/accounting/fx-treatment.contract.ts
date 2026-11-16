/**
 * How an account's foreign-currency balances are measured at a period end (IAS 21).
 *
 *  - `REVALUED`: a monetary item — money held, receivable or payable in a fixed number of units of
 *    currency (IAS 21.16). Its balance in each foreign currency is restated at the closing rate,
 *    and the difference is an unrealised exchange gain or loss (IAS 21.23(a), 28).
 *  - `HISTORICAL`: a non-monetary item — inventory, property and equipment, intangibles, prepaid
 *    expenses, advances settled by delivering goods or services (IFRIC 22), equity, revenue and
 *    expenses. It stays at the rate of the transaction that put it there (IAS 21.23(b)).
 *
 * The accounting leaders state it on the account — Dynamics 365's main-account «Foreign currency
 * revaluation», NetSuite's «Revalue open balance for foreign currency transactions», SAP's
 * valuation settings — rather than infer it, and so does this: `accounts.fx_treatment` is the one
 * place the period-end revaluation reads. The old flag (`isMultiCurrency`) said something else
 * (whether an account held several currencies), and the revaluation had to guess the rest from
 * roles and bank links.
 *
 * Only balance-sheet accounts can be revalued: restating an expense «in dollars» would invent an
 * exchange difference on a cost that was incurred, and paid for, at the rate of its day.
 */
export const FX_TREATMENTS = ['REVALUED', 'HISTORICAL'] as const;
export type FxTreatment = (typeof FX_TREATMENTS)[number];

/** Whether `treatment` is one an account of `type` may have. */
export function isFxTreatmentAllowedForType(type: string | null | undefined, treatment: FxTreatment): boolean {
  return treatment === 'HISTORICAL' || type === 'ASSET' || type === 'LIABILITY';
}

/**
 * What an account of `type` is, foreign-currency-wise, when nothing more is known about it.
 *
 * A liability is money owed in nearly every case — payables, loans, accruals, taxes — so it is
 * revalued. An asset with nothing more said is held at its historical rate: in the opening charts
 * the asset accounts with no operational role are prepaid expenses, property and intangibles, all
 * non-monetary. The person creating the account is shown the choice, and the period close lists
 * foreign-currency balances held at their historical rate for review.
 */
export function defaultFxTreatmentForType(type: string | null | undefined): FxTreatment {
  return type === 'LIABILITY' ? 'REVALUED' : 'HISTORICAL';
}
