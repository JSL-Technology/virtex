import { DEFAULT_DEPRECIATION_CONVENTION, type DepreciationConvention } from '@virtex/shared/types';
import { roundAmount, toCents } from '../common/money';
import { addMonthsIso, endOfMonthIso, monthsBetween, toIsoDate, type IsoDate } from '../common/dates';
import { DepreciationMethod } from './entities/fixed-asset.entity';

/** What the calculation needs to know about an asset. */
export interface DepreciableAsset {
  cost: number;
  residualValue: number;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod | string;
  /** How the month it enters service, and the month it leaves, are charged; `FULL_MONTH` if none. */
  depreciationConvention?: DepreciationConvention | string | null;
  inServiceDate: string;
  accumulatedDepreciation: number;
  depreciatedThrough: string | null;
}

/** One month's charge, and where it leaves the asset. */
export interface ScheduledCharge {
  periodEnd: IsoDate;
  amount: number;
  accumulatedAfter: number;
  bookValueAfter: number;
}

/**
 * The months an asset is due to be charged for, from the first not yet charged through `through`.
 *
 * The run used to charge one month per run, whatever was owed: an asset registered after the
 * month's run had already happened lost that month for good — its write-off simply ended later
 * than its useful life said, and the books carried it at a value too high in the meantime. Every
 * month due is charged now, each recorded as its own month.
 */
export function chargesDue(asset: DepreciableAsset, through: Date | string): ScheduledCharge[] {
  return project(asset, endOfMonthIso(through), null);
}

/**
 * The asset's remaining schedule: every month from the next uncharged one until it is written down
 * to its residual value.
 */
export function remainingSchedule(asset: DepreciableAsset): ScheduledCharge[] {
  return project(asset, null, null);
}

/**
 * What the month an asset leaves the books in is charged, through the day it leaves, by its
 * convention: nothing under `FULL_MONTH`, the whole month under `NEXT_MONTH`, half of it under
 * `MID_MONTH`, the days through the disposal date under `DAILY`. Null when nothing is due.
 *
 * Every month before it must have been charged first: this is the charge of that one month. The
 * month of a disposal was never depreciated, whatever the convention (FINB-12) — an asset sold on
 * the 28th lost four weeks of expense, and its carrying amount, and so the loss on the sale, were
 * overstated by them.
 */
export function disposalMonthCharge(asset: DepreciableAsset, disposalDate: Date | string): ScheduledCharge | null {
  const leaves = toIsoDate(disposalDate);
  const monthEnd = endOfMonthIso(leaves);
  return project(asset, monthEnd, leaves).find((charge) => charge.periodEnd === monthEnd) ?? null;
}

/** The first month an asset is charged for, as its last day: the month it entered service. */
export function firstChargeableMonth(asset: Pick<DepreciableAsset, 'inServiceDate' | 'depreciatedThrough'>): IsoDate {
  return asset.depreciatedThrough
    ? endOfMonthIso(addMonthsIso(`${toIsoDate(asset.depreciatedThrough).slice(0, 7)}-01`, 1))
    : endOfMonthIso(asset.inServiceDate);
}

/**
 * The months due through `through` (all of them when null), for an asset that leaves the books on
 * `leaves` (in use when null).
 *
 * The life is laid on a continuous month axis: a date sits at its month's index plus how far into
 * that month its convention puts it (`serviceStart`, `serviceEnd`). Each calendar month is charged
 * for the stretch of the life it holds — `from` to `to`, in months of service since the start — so a
 * month the asset spent half of in service is charged half a month, and a life of twelve months
 * that starts mid-month ends mid-month, thirteen calendar months later.
 */
function project(asset: DepreciableAsset, through: IsoDate | null, leaves: IsoDate | null): ScheduledCharge[] {
  const life = Math.trunc(Number(asset.usefulLifeMonths));
  if (!Number.isFinite(life) || life <= 0) return [];

  const convention = asset.depreciationConvention ?? DEFAULT_DEPRECIATION_CONVENTION;
  const cost = roundAmount(Number(asset.cost));
  const depreciable = roundAmount(cost - Number(asset.residualValue));
  let accumulated = roundAmount(Number(asset.accumulatedDepreciation));
  const charges: ScheduledCharge[] = [];

  const inService = toIsoDate(asset.inServiceDate);
  const start = serviceStart(convention, inService);
  // Where it stops: when it leaves the books — never before it started.
  const end = leaves === null ? Number.POSITIVE_INFINITY : Math.max(start, serviceEnd(convention, leaves));

  // A bound on the loop that no real schedule reaches: the asset's whole life, from its first
  // month, plus the months it may already be late by, plus the month a convention may carry the
  // life into. A corrupt row cannot spin it forever.
  let month = firstChargeableMonth(asset);
  const guard = life + Math.max(0, monthsBetween(inService, month)) + 2;

  for (let step = 0; step < guard; step++) {
    if (through !== null && month > through) break;
    const remaining = roundAmount(depreciable - accumulated);
    if (toCents(remaining) <= 0) break;

    const index = monthIndex(month);
    // The asset has left the books before this month began.
    if (index >= end) break;
    const from = Math.max(index, start) - start;
    const to = Math.min(index + 1, end) - start;
    const amount = to <= from ? 0 : monthlyCharge(asset.depreciationMethod, { depreciable, cost, accumulated, life, from, to, remaining });
    if (toCents(amount) > 0) {
      accumulated = roundAmount(accumulated + amount);
      charges.push({
        periodEnd: month,
        amount,
        accumulatedAfter: accumulated,
        bookValueAfter: roundAmount(cost - accumulated),
      });
    }
    month = endOfMonthIso(addMonthsIso(`${month.slice(0, 7)}-01`, 1));
  }
  return charges;
}

/** A month's place on the axis: whole months since year 0. */
function monthIndex(date: IsoDate): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

/** The days of the month `date` is in. */
function daysInMonthOf(date: IsoDate): number {
  return Number(endOfMonthIso(date).slice(8, 10));
}

/** Where the life starts on the axis, for an asset that entered service on `date`. */
function serviceStart(convention: DepreciationConvention | string, date: IsoDate): number {
  const index = monthIndex(date);
  switch (convention) {
    case 'NEXT_MONTH':
      return index + 1;
    case 'MID_MONTH':
      return index + 0.5;
    case 'DAILY':
      // From the day it entered service, that day included.
      return index + (Number(date.slice(8, 10)) - 1) / daysInMonthOf(date);
    case 'FULL_MONTH':
    default:
      return index;
  }
}

/** Where it stops on the axis, for an asset that leaves the books on `date`. */
function serviceEnd(convention: DepreciationConvention | string, date: IsoDate): number {
  const index = monthIndex(date);
  switch (convention) {
    case 'NEXT_MONTH':
      return index + 1;
    case 'MID_MONTH':
      return index + 0.5;
    case 'DAILY':
      // Through the day it left, that day included.
      return index + Number(date.slice(8, 10)) / daysInMonthOf(date);
    case 'FULL_MONTH':
    default:
      return index;
  }
}

/** How close to the end of the life a month must reach to be its last: what floating point leaves. */
const END_OF_LIFE_TOLERANCE = 1e-9;

/**
 * One month's charge, for the stretch of the life from `from` to `to` (months of service since the
 * start), capped at what is left.
 *
 * In the month the useful life ends — or after it, for an asset that is late — the charge is
 * whatever remains: straight line in cents leaves a cent or two behind (1 000 over three months
 * is 333.33 three times), and the declining balance never reaches the residual on its own. A month
 * the asset leaves the books in before its life ends is charged its stretch, not the rest.
 */
function monthlyCharge(
  method: DepreciationMethod | string,
  state: { depreciable: number; cost: number; accumulated: number; life: number; from: number; to: number; remaining: number },
): number {
  const { depreciable, cost, accumulated, life, from, to, remaining } = state;
  if (to >= life - END_OF_LIFE_TOLERANCE) return remaining;
  const portion = to - from;

  let charge: number;
  switch (method) {
    case DepreciationMethod.SUM_OF_YEARS_DIGITS:
      charge = sumOfYearsDigitsCharge(depreciable, life, from, to);
      break;
    case DepreciationMethod.DOUBLE_DECLINING_BALANCE: {
      // Twice the straight-line rate on the book value at the start of the month — until straight
      // line on what is left over the months left gives more, from when on that is the charge.
      // Without the switch the declining balance never reached the residual on its own and the
      // last month took the rest at once: 134.58 after 26.92 on a twelve-month asset (FINB-11).
      const declining = (cost - accumulated) * (2 / life) * portion;
      const straight = (remaining * portion) / (life - from);
      charge = Math.max(declining, straight);
      break;
    }
    case DepreciationMethod.STRAIGHT_LINE:
    default:
      // What is left over the months left. On schedule this is the depreciable base over the life;
      // after a change of estimate — a longer life, a new residual value — it spreads the rest
      // over what remains, which is how a change in estimate is applied (prospectively, IAS 8).
      charge = (remaining * portion) / (life - from);
      break;
  }
  return roundAmount(Math.max(0, Math.min(charge, remaining)));
}

/**
 * The sum-of-the-years'-digits charge for the stretch from `from` to `to` months of a life of
 * `life` months (a whole month from `age` to `age + 1`; less for a month in service in part).
 *
 * Each year's digit is the life left at its start, weighted by how much of a year it is: L, L−1, …
 * for the whole years of a life of L years, and f × f for a final part-year of f. A life in whole
 * years gives the textbook schedule — 60 months: 5/15, 4/15, …, 1/15 — and every year's share is
 * spread evenly over its months.
 *
 * It took the life as `ceil(L)` whole years, so a part-year was charged as if it were twelve
 * months of its digit and the last month took whatever was left: 18 months charged 12 × 100,
 * 5 × 50 and then 350 (FINB-11). With the part-year weighted for what it is, 18 months charge
 * 1.5/1.75 of the base over the first twelve and 0.25/1.75 over the last six.
 */
function sumOfYearsDigitsCharge(depreciable: number, life: number, from: number, to: number): number {
  // The difference of two rounded running totals, so the cents fall evenly month by month and the
  // months add up to the base exactly, whatever the life — a share rounded month by month left
  // the cents it lost for the last month.
  return roundAmount(roundAmount(depreciable * sumOfYearsDigitsShare(life, to)) - roundAmount(depreciable * sumOfYearsDigitsShare(life, from)));
}

/** The share of the base the sum of the years' digits has charged after `months` months of `life`. */
function sumOfYearsDigitsShare(life: number, months: number): number {
  const lifeYears = life / 12;
  const wholeYears = Math.floor(lifeYears);
  const partYear = lifeYears - wholeYears;
  const sumOfDigits = wholeYears * lifeYears - (wholeYears * (wholeYears - 1)) / 2 + partYear * partYear;
  const elapsed = Math.min(Math.max(months, 0), life);
  const fullYears = Math.min(Math.floor(elapsed / 12), wholeYears);
  let weight = fullYears * lifeYears - (fullYears * (fullYears - 1)) / 2;
  const intoYear = elapsed - fullYears * 12;
  if (fullYears < wholeYears) {
    weight += ((lifeYears - fullYears) * intoYear) / 12;
  } else {
    const partMonths = life - wholeYears * 12;
    if (partMonths > 0) weight += (partYear * partYear * Math.min(intoYear, partMonths)) / partMonths;
  }
  return weight / sumOfDigits;
}
