import { roundAmount, toCents } from '../common/money';
import { addMonthsIso, endOfMonthIso, monthsBetween, toIsoDate, type IsoDate } from '../common/dates';
import { DepreciationMethod } from './entities/fixed-asset.entity';

/** What the calculation needs to know about an asset. */
export interface DepreciableAsset {
  cost: number;
  residualValue: number;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod | string;
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
  return project(asset, endOfMonthIso(through));
}

/**
 * The asset's remaining schedule: every month from the next uncharged one until it is written down
 * to its residual value.
 */
export function remainingSchedule(asset: DepreciableAsset): ScheduledCharge[] {
  return project(asset, null);
}

/** The first month an asset is charged for, as its last day: the month it entered service. */
export function firstChargeableMonth(asset: Pick<DepreciableAsset, 'inServiceDate' | 'depreciatedThrough'>): IsoDate {
  return asset.depreciatedThrough
    ? endOfMonthIso(addMonthsIso(`${toIsoDate(asset.depreciatedThrough).slice(0, 7)}-01`, 1))
    : endOfMonthIso(asset.inServiceDate);
}

function project(asset: DepreciableAsset, through: IsoDate | null): ScheduledCharge[] {
  const life = Math.trunc(Number(asset.usefulLifeMonths));
  if (!Number.isFinite(life) || life <= 0) return [];

  const cost = roundAmount(Number(asset.cost));
  const depreciable = roundAmount(cost - Number(asset.residualValue));
  let accumulated = roundAmount(Number(asset.accumulatedDepreciation));
  const charges: ScheduledCharge[] = [];

  // A bound on the loop that no real schedule reaches: the asset's whole life, from its first
  // month, plus the months it may already be late by. A corrupt row cannot spin it forever.
  let month = firstChargeableMonth(asset);
  const guard = life + Math.max(0, monthsBetween(asset.inServiceDate, month)) + 1;

  for (let step = 0; step < guard; step++) {
    if (through !== null && month > through) break;
    const remaining = roundAmount(depreciable - accumulated);
    if (toCents(remaining) <= 0) break;

    const age = monthsBetween(asset.inServiceDate, month);
    const amount = age < 0 ? 0 : monthlyCharge(asset.depreciationMethod, { depreciable, cost, accumulated, life, age, remaining });
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

/**
 * One month's charge, capped at what is left.
 *
 * In the last month of the useful life — or after it, for an asset that is late — the charge is
 * whatever remains: straight line in cents leaves a cent or two behind (1 000 over three months
 * is 333.33 three times), and the declining balance never reaches the residual on its own.
 */
function monthlyCharge(
  method: DepreciationMethod | string,
  state: { depreciable: number; cost: number; accumulated: number; life: number; age: number; remaining: number },
): number {
  const { depreciable, cost, accumulated, life, age, remaining } = state;
  if (age >= life - 1) return remaining;

  let charge: number;
  switch (method) {
    case DepreciationMethod.SUM_OF_YEARS_DIGITS:
      charge = sumOfYearsDigitsCharge(depreciable, life, age);
      break;
    case DepreciationMethod.DOUBLE_DECLINING_BALANCE: {
      // Twice the straight-line rate on the book value at the start of the month — until straight
      // line on what is left over the months left gives more, from when on that is the charge.
      // Without the switch the declining balance never reached the residual on its own and the
      // last month took the rest at once: 134.58 after 26.92 on a twelve-month asset (FINB-11).
      const declining = (cost - accumulated) * (2 / life);
      const straight = remaining / (life - age);
      charge = Math.max(declining, straight);
      break;
    }
    case DepreciationMethod.STRAIGHT_LINE:
    default:
      // What is left over the months left. On schedule this is the depreciable base over the life;
      // after a change of estimate — a longer life, a new residual value — it spreads the rest
      // over what remains, which is how a change in estimate is applied (prospectively, IAS 8).
      charge = remaining / (life - age);
      break;
  }
  return roundAmount(Math.max(0, Math.min(charge, remaining)));
}

/**
 * The sum-of-the-years'-digits charge for month `age` (from 0) of a life of `life` months.
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
function sumOfYearsDigitsCharge(depreciable: number, life: number, age: number): number {
  // The difference of two rounded running totals, so the cents fall evenly month by month and the
  // months add up to the base exactly, whatever the life — a share rounded month by month left
  // the cents it lost for the last month.
  return roundAmount(roundAmount(depreciable * sumOfYearsDigitsShare(life, age + 1)) - roundAmount(depreciable * sumOfYearsDigitsShare(life, age)));
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
