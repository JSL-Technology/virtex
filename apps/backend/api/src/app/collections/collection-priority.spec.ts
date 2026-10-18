import { ageLikelihood, rankCollection, CollectionFacts } from './collection-priority';

const base: CollectionFacts = {
  balanceBase: 10_000,
  daysOverdue: 10,
  pBy7: null,
  pBy30: null,
  doubtful: false,
  brokenPromises: 0,
  openPromiseDate: null,
  daysSinceContact: null,
};

describe('collection priority', () => {
  it('ranks a debt that will not arrive on its own above one that will', () => {
    const likely = rankCollection({ ...base, pBy30: 0.9 });
    const unlikely = rankCollection({ ...base, pBy30: 0.1 });
    expect(unlikely.priority).toBeGreaterThan(likely.priority);
    expect(unlikely.reasons).toContain('unlikely_soon');
    expect(likely.likelihoodSource).toBe('projection');
  });

  it('falls back on age when there is no projection, and says so', () => {
    const ranking = rankCollection({ ...base, daysOverdue: 95 });
    expect(ranking.likelihoodSource).toBe('age');
    expect(ranking.pBy30).toBe(ageLikelihood(95));
    expect(ranking.action).toBe('call');
  });

  it('weighs a larger and older debt more', () => {
    expect(rankCollection({ ...base, balanceBase: 20_000 }).priority).toBeGreaterThan(rankCollection(base).priority);
    expect(rankCollection({ ...base, daysOverdue: 120, pBy30: 0.5 }).priority).toBeGreaterThan(
      rankCollection({ ...base, daysOverdue: 5, pBy30: 0.5 }).priority,
    );
  });

  it('moves a broken promise up and asks for a call', () => {
    const broken = rankCollection({ ...base, brokenPromises: 1 });
    expect(broken.priority).toBeGreaterThan(rankCollection(base).priority);
    expect(broken.action).toBe('call');
    expect(broken.reasons).toContain('broken_promise');
  });

  it('waits on a promise still in date, and after a contact in the last three days', () => {
    const promised = rankCollection({ ...base, openPromiseDate: '2026-10-25' });
    expect(promised.action).toBe('await_promise');
    expect(promised.priority).toBeLessThan(rankCollection(base).priority);

    const contacted = rankCollection({ ...base, daysSinceContact: 1 });
    expect(contacted.action).toBe('wait');
    expect(rankCollection({ ...base, daysSinceContact: 5 }).action).toBe('reminder');
  });

  it('suggests the reminder by how overdue the invoice is', () => {
    expect(rankCollection({ ...base, daysOverdue: 15 }).action).toBe('reminder');
    expect(rankCollection({ ...base, daysOverdue: 45 }).action).toBe('firm_reminder');
    expect(rankCollection({ ...base, daysOverdue: 75 }).action).toBe('call');
  });

  it('gives a heads-up before the due date only when payment looks unlikely that week', () => {
    expect(rankCollection({ ...base, daysOverdue: -3, pBy7: 0.2, pBy30: 0.6 }).action).toBe('courtesy_reminder');
    expect(rankCollection({ ...base, daysOverdue: -3, pBy7: 0.9, pBy30: 0.95 }).action).toBe('none');
    expect(rankCollection({ ...base, daysOverdue: -20, pBy7: 0.1, pBy30: 0.5 }).action).toBe('none');
  });

  it('never ranks a zero or negative balance', () => {
    expect(rankCollection({ ...base, balanceBase: -50 }).priority).toBe(0);
  });
});
