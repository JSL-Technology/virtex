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
  /** The yearly rate of a `DECLINING_BALANCE` method, as a fraction (0.25). */
  decliningAnnualRate?: number | null;
  /**
   * For `STRAIGHT_LINE` stated as a rate, as a tax law states it, rather than as a life: the yearly
   * rate on the depreciable base, every year until it is used up — 35 % of 12 000 is 4 200 a year
   * and 100 in the last month. A new rate applies to the base from then on; a life spreads what is
   * left over what remains of it instead (IAS 8), which is not what a law that fixes rates says.
   * The life is then only a bound.
   */
  straightLineAnnualRate?: number | null;
  /**
   * For `DECLINING_BALANCE`: the month (1–12) the year the rate applies to starts in — the
   * company's fiscal year. January if none.
   */
  fiscalYearStartMonth?: number | null;
  /**
   * What had been charged by the start of the fiscal year the next uncharged month falls in, when
   * months of that year were charged already: what a yearly rate (`DECLINING_BALANCE`) applies to,
   * and what a straight line's year adds up from. Without it the year is taken up from what is left
   * now — exact at a year's start.
   */
  yearOpeningAccumulated?: number | null;
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
  const yearStarts = Math.min(12, Math.max(1, Math.trunc(Number(asset.fiscalYearStartMonth ?? 1)) || 1));
  const opening =
    asset.yearOpeningAccumulated === undefined || asset.yearOpeningAccumulated === null
      ? null
      : roundAmount(Number(asset.yearOpeningAccumulated));
  // A declining balance at a yearly rate applies it to the value at the start of each year — 25 %
  // of 10 000 is 2 500 in the first year, not the 2 235 compounding a twelfth a month gives.
  let yearBase = roundAmount(cost - (opening ?? accumulated));
  // Months of service before the month at `index` begins.
  const position = (index: number) => Math.max(index, start) - start;
  // A straight line over a life runs each year as running totals of what was left at its start
  // over the life left then: a year on schedule adds up to its share to the cent, where a month
  // rounded on its own lost a cent or gained one each time — 12 000 over 36 months charged 3 999.96
  // in its first year. A change of estimate starts the line afresh from the month after it (IAS 8).
  const firstIndex = monthIndex(month);
  let line = { base: roundAmount(depreciable - accumulated), from: position(firstIndex), life: life - position(firstIndex) };
  const intoYear = (Number(month.slice(5, 7)) - yearStarts + 12) % 12;
  if (opening !== null && intoYear > 0) {
    const from = position(firstIndex - intoYear);
    const base = roundAmount(depreciable - opening);
    const span = life - from;
    // On schedule since the year began: the year is picked up where it stands.
    const expected = span > 0 ? roundAmount(opening + roundAmount((base * (position(firstIndex) - from)) / span)) : null;
    if (expected !== null && toCents(expected) === toCents(accumulated)) line = { base, from, life: span };
  }

  for (let step = 0; step < guard; step++) {
    if (through !== null && month > through) break;
    const remaining = roundAmount(depreciable - accumulated);
    if (toCents(remaining) <= 0) break;

    const index = monthIndex(month);
    // The asset has left the books before this month began.
    if (index >= end) break;
    // A new year: the rate now applies to what is left at its start, and the line runs its year
    // from there.
    if (Number(month.slice(5, 7)) === yearStarts && step > 0) {
      yearBase = roundAmount(cost - accumulated);
      line = { base: roundAmount(depreciable - accumulated), from: position(index), life: life - position(index) };
    }
    // How far into its year this month's service runs, before and after it: a declining balance's
    // year is charged as running totals, so its months add up to the year's charge to the cent.
    const yearOrigin = Math.max(index - ((Number(month.slice(5, 7)) - yearStarts + 12) % 12), start);
    const from = Math.max(index, start) - start;
    const to = Math.min(index + 1, end) - start;
    const amount =
      to <= from
        ? 0
        : monthlyCharge(asset.depreciationMethod, {
            depreciable,
            cost,
            accumulated,
            life,
            from,
            to,
            remaining,
            annualRate: Number(asset.decliningAnnualRate ?? 0),
            straightLineRate: Number(asset.straightLineAnnualRate ?? 0),
            line,
            yearBase,
            yearFrom: Math.max(0, Math.max(index, start) - yearOrigin),
            yearTo: Math.max(0, Math.min(index + 1, end) - yearOrigin),
          });
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
  state: {
    depreciable: number;
    cost: number;
    accumulated: number;
    life: number;
    from: number;
    to: number;
    remaining: number;
    annualRate: number;
    /** The yearly rate of a straight line stated as a rate; 0 for one stated as a life. */
    straightLineRate: number;
    /**
     * A straight line over a life, for the current year: what was left to depreciate at its start,
     * the months of service before it, and the life left then.
     */
    line: { base: number; from: number; life: number };
    /** The value not yet depreciated at the start of the current year (`DECLINING_BALANCE`). */
    yearBase: number;
    /** Months of service in the current year before this month's stretch, and after it. */
    yearFrom: number;
    yearTo: number;
  },
): number {
  const { depreciable, cost, accumulated, life, from, to, remaining, annualRate, straightLineRate, line, yearBase, yearFrom, yearTo } = state;
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
    case DepreciationMethod.DECLINING_BALANCE:
      // The yearly rate on the value not yet depreciated at the start of the year, a twelfth of it
      // a month, for the part of the month in service. No switch to straight line: a tax
      // authority's declining balance runs on what is left until the asset leaves, and the life is
      // only where the rest is written off.
      charge = roundAmount((yearBase * annualRate * yearTo) / 12) - roundAmount((yearBase * annualRate * yearFrom) / 12);
      break;
    case DepreciationMethod.STRAIGHT_LINE:
    default:
      if (straightLineRate > 0) {
        // Stated as a rate: the rate on the base, a twelfth a month for the part of the month in
        // service, as running totals within the year — each year adds up to the rate on the base
        // to the cent.
        charge = roundAmount((depreciable * straightLineRate * yearTo) / 12) - roundAmount((depreciable * straightLineRate * yearFrom) / 12);
        break;
      }
      // Stated as a life: what was left at the year's start over the life left then, as running
      // totals. On schedule this is the depreciable base over the life; after a change of
      // estimate — a longer life, a new residual value — the line starts again from what is left,
      // which is how a change in estimate is applied (prospectively, IAS 8).
      charge =
        line.life > 0
          ? roundAmount((line.base * (to - line.from)) / line.life) - roundAmount((line.base * (from - line.from)) / line.life)
          : (remaining * portion) / (life - from);
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

