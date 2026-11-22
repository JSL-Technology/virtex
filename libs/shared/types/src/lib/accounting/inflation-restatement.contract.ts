import type { FxTreatment } from './fx-treatment.contract';

/**
 * Restatement for inflation (IAS 29, «Financial Reporting in Hyperinflationary Economies»; in
 * Argentina RT 6 of the FACPCE, in Venezuela BA VEN-NIF 2 — each to be confirmed with a local
 * accountant).
 *
 * In an economy whose currency loses its purchasing power quickly, a balance sheet that adds pesos
 * of 2019 to pesos of this month adds different units. The standard expresses every figure in the
 * measuring unit current at the end of the period:
 *
 *  - MONETARY items — money held, amounts receivable or payable in a fixed number of units — are
 *    already in that unit and are NOT restated (IAS 29.12). They are the same accounts the
 *    period-end foreign-currency revaluation treats as monetary (`fx_treatment = 'REVALUED'`,
 *    IAS 21.16): one classification, read by both.
 *  - NON-MONETARY items — inventory, property and its depreciation, intangibles, prepayments,
 *    advances settled in goods, equity — are restated from the date each amount ORIGINATED: the
 *    restated cost is the historical cost times the change in a general price index since the
 *    acquisition (IAS 29.15).
 *  - Income and expenses are restated from the date each was recorded (IAS 29.26).
 *  - What the restatement of everything else nets to is the gain or loss on the net monetary
 *    position (IAS 29.27-28; «RECPAM» in Argentina), booked to its own account — which is itself
 *    never restated.
 */

/**
 * When the period close restates the books.
 *
 *  - `NONE`: the company does not apply inflation accounting. Nothing is restated at a close; the
 *    restatement can still be run by hand for any open period.
 *  - `YEAR_END`: the close of the last period of each fiscal year restates the books before the
 *    year's result is transferred — the minimum the annual statements of a hyperinflationary
 *    economy require. Interim periods may be restated by hand.
 *  - `EVERY_PERIOD`: every period close restates the books, for statements in constant currency
 *    each month.
 *
 * Each restatement is computed in full from the origin of every amount, so restating only at the
 * year end gives the same December figures as restating every month.
 */
export const INFLATION_ADJUSTMENT_POLICIES = ['NONE', 'YEAR_END', 'EVERY_PERIOD'] as const;
export type InflationAdjustmentPolicy = (typeof INFLATION_ADJUSTMENT_POLICIES)[number];

/** Whether the close of a period must restate the books, under `policy`. */
export function restatementDueAtClose(policy: InflationAdjustmentPolicy | null | undefined, isLastPeriodOfFiscalYear: boolean): boolean {
  if (policy === 'EVERY_PERIOD') return true;
  if (policy === 'YEAR_END') return isLastPeriodOfFiscalYear;
  return false;
}

/** The role of the account that takes the gain or loss on the net monetary position. */
export const NET_MONETARY_POSITION_ROLE = 'INFLATION_ADJUSTMENT';

export interface RestatableAccountFacts {
  type: string | null | undefined;
  fxTreatment: FxTreatment | null | undefined;
  isPostable: boolean;
  systemRole?: string | null;
}

/**
 * Whether an account CAN be restated: a postable, non-monetary account that is not the account of
 * the gain or loss on the net monetary position.
 *
 * A monetary account restated by the index would count the same loss of purchasing power twice —
 * once in its own balance and once in the net monetary position — so it is refused, here and by
 * the database (`CHK_accounts_inflation_restatement_non_monetary`). Income and expenses are always
 * non-monetary; a balance-sheet account is non-monetary when it is held at its historical rate.
 */
export function isRestatableAccount(account: RestatableAccountFacts): boolean {
  if (!account.isPostable) return false;
  if (account.systemRole === NET_MONETARY_POSITION_ROLE) return false;
  if (account.type === 'REVENUE' || account.type === 'EXPENSE' || account.type === 'EQUITY') return true;
  if (account.type === 'ASSET' || account.type === 'LIABILITY') return account.fxTreatment !== 'REVALUED';
  return false;
}

/**
 * Whether an account is restated when nothing more is known about it: every account that can be.
 *
 * The exceptions are a judgement for the company's accountant, which the account form asks for: a
 * non-monetary item already carried at a CURRENT amount — net realisable value, fair value,
 * replacement cost — is not restated (IAS 29.14).
 */
export function defaultInflationRestatement(account: RestatableAccountFacts): boolean {
  return isRestatableAccount(account);
}

/**
 * Whether the account's balance belongs to the fiscal year only: income and expenses start every
 * year from nothing, after the result is transferred to equity, so only the year's own amounts are
 * restated. A balance-sheet account carries its whole history.
 */
export function isNominalAccountType(type: string | null | undefined): boolean {
  return type === 'REVENUE' || type === 'EXPENSE';
}

/** `2026-03` — the month a restatement is for, and the period an index value belongs to. */
export const ISO_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
