import { chargesDue, disposalMonthCharge, firstChargeableMonth, remainingSchedule, DepreciableAsset } from './depreciation-schedule';
import { DepreciationMethod } from './entities/fixed-asset.entity';

const cents = (values: number[]) => values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100;

describe('depreciation schedule', () => {
  const asset = (overrides: Partial<DepreciableAsset> = {}): DepreciableAsset => ({
    cost: 1_000,
    residualValue: 0,
    usefulLifeMonths: 3,
    depreciationMethod: DepreciationMethod.STRAIGHT_LINE,
    inServiceDate: '2026-01-20',
    accumulatedDepreciation: 0,
    depreciatedThrough: null,
    ...overrides,
  });

  it('starts in the month the asset entered service, and after the last month charged', () => {
    expect(firstChargeableMonth(asset())).toBe('2026-01-31');
    expect(firstChargeableMonth(asset({ depreciatedThrough: '2026-01-31' }))).toBe('2026-02-28');
  });

  it('writes straight line down to the cent, each month spreading what is left', () => {
    const schedule = remainingSchedule(asset());
    // 1 000 / 3, then 666.67 / 2, then what remains: the three add up exactly.
    expect(schedule.map((row) => row.amount)).toEqual([333.33, 333.34, 333.33]);
    expect(schedule[2]).toMatchObject({ periodEnd: '2026-03-31', accumulatedAfter: 1_000, bookValueAfter: 0 });
  });

  it('charges every month due through the date, and nothing for a month not yet in service', () => {
    expect(chargesDue(asset(), '2026-02-15').map((row) => row.periodEnd)).toEqual(['2026-01-31', '2026-02-28']);
    expect(chargesDue(asset({ inServiceDate: '2026-05-01' }), '2026-03-31')).toEqual([]);
  });

  it('never charges below the residual value, whatever the method', () => {
    for (const method of Object.values(DepreciationMethod)) {
      // A declining balance at a yearly rate needs its rate; the life is where what is left goes.
      const decliningAnnualRate = method === DepreciationMethod.DECLINING_BALANCE ? 0.3 : null;
      const schedule = remainingSchedule(
        asset({ cost: 50_000, residualValue: 5_000, usefulLifeMonths: 48, depreciationMethod: method, decliningAnnualRate }),
      );
      expect(cents(schedule.map((row) => row.amount))).toBe(45_000);
      expect(schedule[schedule.length - 1].bookValueAfter).toBe(5_000);
      expect(schedule).toHaveLength(48);
    }
  });

  it('charges the declining balance faster at the start than straight line', () => {
    const declining = remainingSchedule(asset({ cost: 12_000, usefulLifeMonths: 24, depreciationMethod: DepreciationMethod.DOUBLE_DECLINING_BALANCE }));
    const straight = remainingSchedule(asset({ cost: 12_000, usefulLifeMonths: 24 }));
    expect(declining[0].amount).toBe(1_000);
    expect(straight[0].amount).toBe(500);
  });

  it('spreads the rest over the life that is left when the estimate changes', () => {
    // 60 months, 12 charged at 2 000, then the life is extended to 120: 96 000 over 108 months.
    const extended = remainingSchedule(
      asset({ cost: 120_000, usefulLifeMonths: 120, inServiceDate: '2025-01-01', accumulatedDepreciation: 24_000, depreciatedThrough: '2025-12-31' }),
    );
    expect(extended).toHaveLength(108);
    expect(extended[0].amount).toBe(888.89);
    expect(cents(extended.map((row) => row.amount))).toBe(96_000);
  });

  it('catches up a late asset in one go, and finishes it if it is past its life', () => {
    const late = chargesDue(asset({ inServiceDate: '2025-01-01', usefulLifeMonths: 6 }), '2026-03-31');
    expect(late).toHaveLength(6);
    expect(late[late.length - 1].periodEnd).toBe('2025-06-30');
    expect(cents(late.map((row) => row.amount))).toBe(1_000);
  });

  it('charges nothing for an asset already written down', () => {
    expect(remainingSchedule(asset({ accumulatedDepreciation: 1_000, depreciatedThrough: '2026-03-31' }))).toEqual([]);
  });
});

/**
 * The accelerated methods over the life the asset actually has (FINB-11): no month takes the rest
 * at once because the method lost track of where the life ends.
 */
describe('accelerated methods over the real life', () => {
  const asset = (overrides: Partial<DepreciableAsset>): DepreciableAsset => ({
    cost: 1_800,
    residualValue: 0,
    usefulLifeMonths: 18,
    depreciationMethod: DepreciationMethod.SUM_OF_YEARS_DIGITS,
    inServiceDate: '2026-01-10',
    accumulatedDepreciation: 0,
    depreciatedThrough: null,
    ...overrides,
  });
  const amounts = (overrides: Partial<DepreciableAsset>) => remainingSchedule(asset(overrides)).map((row) => row.amount);
  /** No month charges more than the one before it, but for the cent the rounding hands on. */
  const nonIncreasing = (values: number[]) =>
    values.every((value, index) => index === 0 || Math.round(value * 100) <= Math.round(values[index - 1] * 100) + 1);
  const within = (values: number[], low: number, high: number) => values.every((value) => value >= low && value <= high);

  it('sum of the years\' digits over 18 months: the last six weigh as half a year, not as a whole one', () => {
    const schedule = amounts({});
    expect(schedule).toHaveLength(18);
    // 1.5 / 1.75 of 1 800 over the first twelve months, 0.25 / 1.75 over the last six; the cents
    // of 1 542.857… fall evenly, never all into one month.
    expect(within(schedule.slice(0, 12), 128.57, 128.58)).toBe(true);
    expect(cents(schedule.slice(0, 12))).toBe(1_542.86);
    expect(within(schedule.slice(12), 42.85, 42.86)).toBe(true);
    expect(cents(schedule)).toBe(1_800);
    // Before: 12 × 100, 5 × 50 and 350 in the last month.
    expect(Math.max(...schedule.slice(12))).toBeLessThan(43);
    expect(nonIncreasing(schedule)).toBe(true);
  });

  it('a life in whole years keeps the textbook schedule: 60 months charge 5/15, 4/15, … of the base', () => {
    const schedule = amounts({ cost: 15_000, usefulLifeMonths: 60 });
    expect(within(schedule.slice(0, 12), 416.66, 416.67)).toBe(true); // 5 000 / 12
    expect(cents(schedule.slice(12, 24))).toBeCloseTo(4_000, 0);
    expect(cents(schedule.slice(48))).toBeCloseTo(1_000, 0);
    expect(cents(schedule)).toBe(15_000);
  });

  it('every life adds up to the base, month by month never more than the month before', () => {
    for (const life of [1, 5, 11, 13, 18, 25, 30, 47, 61, 119]) {
      const schedule = amounts({ cost: 10_000, residualValue: 1_000, usefulLifeMonths: life });
      expect([life, cents(schedule)]).toEqual([life, 9_000]);
      expect([life, nonIncreasing(schedule)]).toEqual([life, true]);
    }
  });

  it('double declining balance switches to straight line: no spike in the last month', () => {
    const schedule = amounts({ cost: 1_200, usefulLifeMonths: 12, depreciationMethod: DepreciationMethod.DOUBLE_DECLINING_BALANCE });
    expect(schedule).toHaveLength(12);
    expect(cents(schedule)).toBe(1_200);
    // Before: 26.92 and then 134.58. Once straight line on what is left is larger, it is the charge.
    expect(nonIncreasing(schedule)).toBe(true);
    const last = schedule[11];
    expect(last).toBeLessThanOrEqual(schedule[10] + 0.01);
    expect(schedule[0]).toBe(200); // twice the straight-line rate on the full cost
  });

  it('the switch reaches the residual exactly, at the end of the life', () => {
    for (const life of [6, 12, 24, 36, 60]) {
      const schedule = remainingSchedule(asset({ cost: 50_000, residualValue: 5_000, usefulLifeMonths: life, depreciationMethod: DepreciationMethod.DOUBLE_DECLINING_BALANCE }));
      expect([life, schedule.length, schedule[schedule.length - 1].bookValueAfter]).toEqual([life, life, 5_000]);
      expect([life, nonIncreasing(schedule.map((row) => row.amount))]).toEqual([life, true]);
    }
  });
});

/**
 * Where the life sits on the calendar (FINB-12).
 *
 * The convention was fixed: an asset entering service on the 31st of January was charged all of
 * January (166.67 of a 10 000, five-year asset), and the month it was sold in was never charged at
 * all. Each convention spreads the same base over the same life; what changes is how much of the
 * first and of the last calendar month the life holds.
 */
describe('depreciation conventions', () => {
  const asset = (overrides: Partial<DepreciableAsset> = {}): DepreciableAsset => ({
    cost: 1_200,
    residualValue: 0,
    usefulLifeMonths: 12,
    depreciationMethod: DepreciationMethod.STRAIGHT_LINE,
    depreciationConvention: 'FULL_MONTH',
    inServiceDate: '2026-01-31',
    accumulatedDepreciation: 0,
    depreciatedThrough: null,
    ...overrides,
  });
  const months = (overrides: Partial<DepreciableAsset>) => remainingSchedule(asset(overrides)).map((row) => [row.periodEnd.slice(0, 7), row.amount]);
  /** The asset with every month through `through` charged, as a run would leave it. */
  const chargedThrough = (overrides: Partial<DepreciableAsset>, through: string): DepreciableAsset => {
    const before = asset(overrides);
    const charges = chargesDue(before, through);
    const last = charges[charges.length - 1];
    return { ...before, accumulatedDepreciation: last?.accumulatedAfter ?? 0, depreciatedThrough: last?.periodEnd ?? null };
  };

  it('the audit\'s asset, in service on the 31st of January: a whole January only under the full-month convention', () => {
    const base = { cost: 10_000, usefulLifeMonths: 60 };
    const january = (convention: string) => chargesDue(asset({ ...base, depreciationConvention: convention }), '2026-01-31')[0]?.amount ?? 0;
    expect(january('FULL_MONTH')).toBe(166.67);
    expect(january('MID_MONTH')).toBe(83.33);
    expect(january('DAILY')).toBe(5.38); // one day of thirty-one
    expect(january('NEXT_MONTH')).toBe(0);
  });

  it('full month: twelve whole months from the month it entered service', () => {
    const schedule = months({});
    expect(schedule).toHaveLength(12);
    expect(schedule[0]).toEqual(['2026-01', 100]);
    expect(schedule[11]).toEqual(['2026-12', 100]);
  });

  it('next month: nothing in the month it entered service, twelve whole months after', () => {
    const schedule = months({ depreciationConvention: 'NEXT_MONTH' });
    expect(schedule).toHaveLength(12);
    expect(schedule[0]).toEqual(['2026-02', 100]);
    expect(schedule[11]).toEqual(['2027-01', 100]);
  });

  it('mid month: half a month at each end, thirteen calendar months in all', () => {
    const schedule = months({ depreciationConvention: 'MID_MONTH' });
    expect(schedule).toHaveLength(13);
    expect(schedule[0]).toEqual(['2026-01', 50]);
    expect(schedule.slice(1, 12).every(([, amount]) => amount === 100)).toBe(true);
    expect(schedule[12]).toEqual(['2027-01', 50]);
  });

  it('daily: the days in service, from the day it entered through the end of its life', () => {
    const schedule = months({ depreciationConvention: 'DAILY', inServiceDate: '2026-01-21' });
    // Eleven days of January's thirty-one, then whole months, then the twenty days left of the life.
    expect(schedule).toHaveLength(13);
    expect(schedule[0]).toEqual(['2026-01', 35.48]);
    expect(schedule.slice(1, 12).every(([, amount]) => amount === 100)).toBe(true);
    expect(schedule[12]).toEqual(['2027-01', 64.52]);
  });

  it.each(['FULL_MONTH', 'NEXT_MONTH', 'MID_MONTH', 'DAILY'])(
    '%s spreads the same base over the same life, whatever the method',
    (convention) => {
      for (const method of [DepreciationMethod.STRAIGHT_LINE, DepreciationMethod.DOUBLE_DECLINING_BALANCE, DepreciationMethod.SUM_OF_YEARS_DIGITS]) {
        for (const inServiceDate of ['2026-01-01', '2026-01-17', '2026-02-28']) {
          const schedule = remainingSchedule(asset({ cost: 50_000, residualValue: 2_000, usefulLifeMonths: 18, depreciationMethod: method, depreciationConvention: convention, inServiceDate }));
          const total = schedule.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
          expect([method, inServiceDate, total, schedule[schedule.length - 1].bookValueAfter]).toEqual([method, inServiceDate, 4_800_000, 2_000]);
        }
      }
    },
  );

  it('the month of a disposal, through the day it leaves the books, by its convention', () => {
    // In service in January, charged through May, sold on the 10th of June.
    const sold = (convention: string) => disposalMonthCharge(chargedThrough({ depreciationConvention: convention, inServiceDate: '2026-01-01' }, '2026-05-31'), '2026-06-10');
    expect(sold('FULL_MONTH')).toBeNull();
    expect(sold('NEXT_MONTH')).toMatchObject({ periodEnd: '2026-06-30', amount: 100 });
    expect(sold('MID_MONTH')).toMatchObject({ periodEnd: '2026-06-30', amount: 50 });
    // Ten days of June's thirty.
    expect(sold('DAILY')).toMatchObject({ periodEnd: '2026-06-30', amount: 33.33, accumulatedAfter: 533.33, bookValueAfter: 666.67 });
  });

  it('an asset that enters service and leaves in the same month is charged the days between, and only under daily', () => {
    const leaves = (convention: string) => disposalMonthCharge(asset({ depreciationConvention: convention, inServiceDate: '2026-01-10' }), '2026-01-20');
    expect(leaves('FULL_MONTH')).toBeNull();
    expect(leaves('NEXT_MONTH')).toBeNull();
    expect(leaves('MID_MONTH')).toBeNull();
    // The 10th through the 20th: eleven days of thirty-one.
    expect(leaves('DAILY')).toMatchObject({ amount: 35.48 });
  });

  it('a disposal after the life has ended charges what was left, and nothing once written down', () => {
    // Inside the life, a part month is charged its part: 15 days of December's 31 of the 50 left.
    const inLife = asset({ inServiceDate: '2024-01-01', accumulatedDepreciation: 1_150, depreciatedThrough: '2024-11-30', depreciationConvention: 'DAILY' });
    expect(disposalMonthCharge(inLife, '2024-12-15')).toMatchObject({ amount: 24.19 });
    // A life that ended in December 2023, with 50 still to charge — left by a change of estimate.
    const late = asset({ inServiceDate: '2023-01-01', accumulatedDepreciation: 1_150, depreciatedThrough: '2024-11-30' });
    expect(disposalMonthCharge(late, '2024-12-15')).toBeNull(); // full month: not the month it leaves
    expect(disposalMonthCharge({ ...late, depreciationConvention: 'DAILY' }, '2024-12-15')).toMatchObject({ amount: 50 });
    expect(disposalMonthCharge({ ...late, depreciationConvention: 'DAILY', accumulatedDepreciation: 1_200 }, '2024-12-15')).toBeNull();
  });

  describe('a declining balance at a yearly rate — how a tax authority states one', () => {
    const taxBook = (overrides: Partial<DepreciableAsset> = {}): DepreciableAsset =>
      asset({
        cost: 10_000,
        usefulLifeMonths: 1200,
        depreciationMethod: DepreciationMethod.DECLINING_BALANCE,
        decliningAnnualRate: 0.25,
        inServiceDate: '2026-01-10',
        depreciationConvention: 'FULL_MONTH',
        ...overrides,
      });
    const yearTotal = (charges: { periodEnd: string; amount: number }[], year: string) =>
      cents(charges.filter((charge) => charge.periodEnd.startsWith(year)).map((charge) => charge.amount));

    it('charges the rate on the value at the start of each year: 2 500, then 1 875, of 10 000 at 25 %', () => {
      const charges = chargesDue(taxBook(), '2027-12-31');
      expect(yearTotal(charges, '2026')).toBe(2_500);
      expect(yearTotal(charges, '2027')).toBe(1_875);
      // Evenly within a year: a twelfth of the year's charge a month.
      // A twelfth of the year's charge a month, the cents falling where the running total puts them.
      expect(charges.filter((charge) => charge.periodEnd.startsWith('2026')).every((charge) => [208.33, 208.34].includes(charge.amount))).toBe(true);
    });

    it('charges a first year in part for the months in service', () => {
      const charges = chargesDue(taxBook({ inServiceDate: '2026-07-15' }), '2027-12-31');
      expect(yearTotal(charges, '2026')).toBe(1_250);
      expect(yearTotal(charges, '2027')).toBe(2_187.5);
    });

    it('resumes in the middle of a year on the value it started the year at', () => {
      const charges = chargesDue(
        taxBook({ accumulatedDepreciation: 1_250, depreciatedThrough: '2026-06-30', yearOpeningAccumulated: 0 }),
        '2026-12-31',
      );
      expect(charges[0]).toMatchObject({ periodEnd: '2026-07-31', amount: 208.33 });
      expect(yearTotal(charges, '2026')).toBe(1_250);
    });

    it('follows the company\'s fiscal year: a year from April starts again in April', () => {
      const charges = chargesDue(taxBook({ fiscalYearStartMonth: 4 }), '2026-06-30');
      // January to March close the year that started in April: three twelfths of 2 500.
      expect(cents(charges.slice(0, 3).map((charge) => charge.amount))).toBe(625);
      // April: 25 % of the 9 375 left, a twelfth a month.
      expect(charges[3]).toMatchObject({ periodEnd: '2026-04-30', amount: 195.31 });
    });
  });

  describe('a straight line over a life, year by year', () => {
    const line = (overrides: Partial<DepreciableAsset> = {}) =>
      asset({ cost: 12_000, usefulLifeMonths: 36, inServiceDate: '2026-01-01', ...overrides });
    const year = (charges: Array<{ periodEnd: string; amount: number }>, from: string, to: string) =>
      cents(charges.filter((row) => row.periodEnd >= from && row.periodEnd <= to).map((row) => row.amount));

    it('adds up to each year\'s share to the cent: 12 000 over 36 months is 4 000.00 a year', () => {
      const schedule = remainingSchedule(line());
      // A month rounded on its own gave 333.33 twelve times: 3 999.96 in the first year.
      expect(year(schedule, '2026-01-31', '2026-12-31')).toBe(4_000);
      expect(year(schedule, '2027-01-31', '2027-12-31')).toBe(4_000);
      expect(year(schedule, '2028-01-31', '2028-12-31')).toBe(4_000);
      expect(schedule).toHaveLength(36);
      expect(schedule.every((row) => [333.33, 333.34].includes(row.amount))).toBe(true);
    });

    it('picks a year up where it stands, month by month, as one run would in one go', () => {
      const whole = remainingSchedule(line());
      // The state after five months, charged by runs: the year's opening known, it carries on alike.
      const resumed = chargesDue(
        line({ accumulatedDepreciation: whole[4].accumulatedAfter, depreciatedThrough: '2026-05-31', yearOpeningAccumulated: 0 }),
        '2026-12-31',
      );
      expect(resumed.map((row) => row.amount)).toEqual(whole.slice(5, 12).map((row) => row.amount));
    });

    it('starts the line again from what is left after a change of estimate', () => {
      // Six months on a 36-month life, then the life is extended to 48: what is left, 10 000, over
      // the 42 months left — prospectively, IAS 8.
      const next = chargesDue(
        line({ usefulLifeMonths: 48, accumulatedDepreciation: 2_000, depreciatedThrough: '2026-06-30', yearOpeningAccumulated: 0 }),
        '2026-07-31',
      );
      expect(next).toEqual([expect.objectContaining({ periodEnd: '2026-07-31', amount: 238.1 })]);
    });

    it('follows the fiscal year: a year from April adds up from April', () => {
      const schedule = remainingSchedule(line({ fiscalYearStartMonth: 4 }));
      // January to March close the year that started in April 2025: three months of the 36.
      expect(year(schedule, '2026-01-31', '2026-03-31')).toBe(1_000);
      expect(year(schedule, '2026-04-30', '2027-03-31')).toBe(4_000);
    });
  });

  describe('a straight line stated as a yearly rate', () => {
    // As a tax law states it: the rate on the base every year, the life only a bound.
    const atRate = (rate: number, overrides: Partial<DepreciableAsset> = {}) =>
      asset({ cost: 12_000, usefulLifeMonths: 1200, straightLineAnnualRate: rate, inServiceDate: '2026-01-01', ...overrides });

    it('deducts exactly the rate a year, the last month what is left: 35 % of 12 000 is 350 a month', () => {
      const schedule = remainingSchedule(atRate(0.35));
      // 34 months of 350 and a 35th of 100 — never the 4 235.29 a year a life of 34 months gives.
      expect(schedule).toHaveLength(35);
      expect(schedule.slice(0, 34).every((row) => row.amount === 350)).toBe(true);
      expect(schedule[34]).toMatchObject({ periodEnd: '2028-11-30', amount: 100, accumulatedAfter: 12_000, bookValueAfter: 0 });
    });

    it('adds up to the rate on the base each year, to the cent, where a month is not whole cents', () => {
      const schedule = remainingSchedule(atRate(0.35, { cost: 10_000 }));
      const year = (prefix: string) => cents(schedule.filter((row) => row.periodEnd.startsWith(prefix)).map((row) => row.amount));
      // 291.666… a month: 3 500.00 a year, not the 3 500.04 twelve rounded months give.
      expect(year('2026')).toBe(3_500);
      expect(year('2027')).toBe(3_500);
      expect(cents(schedule.map((row) => row.amount))).toBe(10_000);
    });

    it('applies a new rate to the base from then on, not to what is left over the life left', () => {
      // A year at 35 %, then 30 %: 300 a month — not 7 800 over the 28 months a 40-month life leaves.
      const charges = chargesDue(atRate(0.3, { accumulatedDepreciation: 4_200, depreciatedThrough: '2026-12-31' }), '2027-03-31');
      expect(charges.map((row) => row.amount)).toEqual([300, 300, 300]);
    });

    it('starts the month after it enters service where the law says so, and follows the fiscal year', () => {
      const next = remainingSchedule(atRate(0.35, { inServiceDate: '2026-01-20', depreciationConvention: 'NEXT_MONTH' }));
      expect(next[0]).toMatchObject({ periodEnd: '2026-02-28', amount: 350 });
      expect(cents(next.map((row) => row.amount))).toBe(12_000);
      const april = remainingSchedule(atRate(0.35, { cost: 10_000, fiscalYearStartMonth: 4 }));
      // The fiscal year from April: April 2026 to March 2027 is one year at 3 500.
      expect(cents(april.filter((row) => row.periodEnd >= '2026-04-30' && row.periodEnd <= '2027-03-31').map((row) => row.amount))).toBe(3_500);
    });
  });
});

