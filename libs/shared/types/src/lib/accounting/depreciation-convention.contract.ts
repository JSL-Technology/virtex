/**
 * How much of the month an asset enters service in — and of the month it leaves the books in — is
 * depreciated (audit 2026-11-07, FINB-12). Each asset has one, defaulted from its company's.
 *
 *  - `FULL_MONTH`: a whole month for the month it enters service, nothing for the month it leaves.
 *  - `NEXT_MONTH`: nothing for the month it enters service, a whole month for the month it leaves.
 *  - `MID_MONTH`: half a month at each end, whatever the day.
 *  - `DAILY`: the days it was in service — from the day it entered, through the day it left.
 *
 * Every convention spreads the same depreciable base over the same useful life; they differ only in
 * where on the calendar the life sits. Under `MID_MONTH` or `DAILY` a life of twelve months touches
 * thirteen calendar months, the first and the last of them in part. IAS 16.55 starts depreciation
 * when the asset is available for use and stops it when it is derecognised: `DAILY` is the measure
 * itself, the others its customary monthly simplifications. Which one a tax book requires is a
 * question for a local accountant in each market.
 */
export const DEPRECIATION_CONVENTIONS = ['FULL_MONTH', 'NEXT_MONTH', 'MID_MONTH', 'DAILY'] as const;
export type DepreciationConvention = (typeof DEPRECIATION_CONVENTIONS)[number];

/** What a company or an asset that has chosen none follows: what every asset followed before. */
export const DEFAULT_DEPRECIATION_CONVENTION: DepreciationConvention = 'FULL_MONTH';
