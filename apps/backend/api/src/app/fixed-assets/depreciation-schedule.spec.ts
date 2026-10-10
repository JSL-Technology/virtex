import { chargesDue, firstChargeableMonth, remainingSchedule, DepreciableAsset } from './depreciation-schedule';
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
      const schedule = remainingSchedule(asset({ cost: 50_000, residualValue: 5_000, usefulLifeMonths: 48, depreciationMethod: method }));
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
