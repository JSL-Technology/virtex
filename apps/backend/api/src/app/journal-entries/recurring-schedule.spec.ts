import { nextOccurrence, occurrence, occurrencesBetween } from './recurring-schedule';
import { Frequency } from './entities/recurring-journal-entry.entity';
import { allocate } from './journal-entry-templates.service';

describe('recurring schedule', () => {
  const monthly = { frequency: Frequency.MONTHLY, startDate: '2026-01-31', endDate: null };

  it('keeps the day of the start, clamped to short months, without drifting', () => {
    expect([0, 1, 2, 3].map((index) => occurrence(monthly, index))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('posts 29 February on the 28th in a common year', () => {
    const leap = { frequency: Frequency.ANNUALLY, startDate: '2024-02-29', endDate: null };
    expect([occurrence(leap, 1), occurrence(leap, 4)]).toEqual(['2025-02-28', '2028-02-29']);
  });

  it('catches up every occurrence since the last one posted, and none before', () => {
    expect(occurrencesBetween(monthly, '2026-01-31', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrencesBetween({ frequency: Frequency.WEEKLY, startDate: '2026-03-02', endDate: null }, null, '2026-03-20')).toEqual([
      '2026-03-02',
      '2026-03-09',
      '2026-03-16',
    ]);
  });

  it('stops at the end date, and says when nothing is left', () => {
    const ending = { frequency: Frequency.DAILY, startDate: '2026-03-01', endDate: '2026-03-03' };
    expect(occurrencesBetween(ending, null, '2026-03-31')).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(nextOccurrence(ending, '2026-03-03')).toBeNull();
    expect(nextOccurrence(monthly, '2026-02-28')).toBe('2026-03-31');
  });

  it('never catches up more than a year of occurrences in one go', () => {
    expect(occurrencesBetween({ frequency: Frequency.DAILY, startDate: '2020-01-01', endDate: null }, null, '2026-01-01')).toHaveLength(366);
  });
});

describe('template allocation', () => {
  it('splits each side by its percentages, the last line taking the rounding', () => {
    const lines = [
      { accountId: 'rent', type: 'DEBIT' as const, percentage: 33.3333 },
      { accountId: 'rent', type: 'DEBIT' as const, percentage: 33.3333 },
      { accountId: 'rent', type: 'DEBIT' as const, percentage: 33.3334 },
      { accountId: 'bank', type: 'CREDIT' as const },
    ];
    const amounts = allocate(lines, 1_000);
    expect(amounts).toEqual([333.33, 333.33, 333.34, 1_000]);
  });

  it('splits equally when no percentages are given', () => {
    const amounts = allocate(
      [
        { accountId: 'a', type: 'DEBIT' },
        { accountId: 'b', type: 'CREDIT' },
        { accountId: 'c', type: 'CREDIT' },
        { accountId: 'd', type: 'CREDIT' },
      ],
      100,
    );
    expect(amounts).toEqual([100, 33.33, 33.33, 33.34]);
  });
});
