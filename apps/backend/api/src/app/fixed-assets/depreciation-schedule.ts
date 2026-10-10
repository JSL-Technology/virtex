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
    case DepreciationMethod.SUM_OF_YEARS_DIGITS: {
      // The annual sum-of-the-years'-digits, spread evenly over each year's twelve months.
      const years = Math.ceil(life / 12);
      const sumOfDigits = (years * (years + 1)) / 2;
      const year = Math.floor(age / 12) + 1;
      charge = year <= years ? (depreciable * (years - year + 1)) / sumOfDigits / 12 : remaining;
      break;
    }
    case DepreciationMethod.DOUBLE_DECLINING_BALANCE:
      // Twice the straight-line rate on the book value at the start of the month.
      charge = (cost - accumulated) * (2 / life);
      break;
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
