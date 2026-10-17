import { CashflowService, boundScenario } from './cashflow.service';
import { CashPositionRegistry } from '../../contracts/treasury/cash-position.contract';

describe('CashflowService', () => {
  const build = () => {
    const runs = {
      request: jest.fn(async (organizationId: string, kind: string, trigger: string, userId: string | null, params: Record<string, unknown>) => ({
        id: 'run-1', kind, status: 'QUEUED', createdAt: new Date(), finishedAt: null, error: null, params,
      })),
      latest: jest.fn(),
      latestSucceeded: jest.fn(),
    };
    const cash = new CashPositionRegistry();
    cash.provide({ summary: async () => ({ asOfDate: '2026-10-17', baseCurrency: 'DOP', total: 125_000 }) });
    const service = new CashflowService(runs as never, cash, {} as never, {} as never, {} as never);
    return { service, runs };
  };

  it("starts the projection from today's cash in the ledger", async () => {
    const { service, runs } = build();
    await service.refresh('org-1', 'u-1');
    expect(runs.request).toHaveBeenCalledWith('org-1', 'CASHFLOW', 'MANUAL', 'u-1', {
      openingCash: 125_000, baseCurrency: 'DOP', asOfDate: '2026-10-17', threshold: 0,
    });
  });

  it('runs a scenario beside the projection, bounded, and refuses one that changes nothing', async () => {
    const { service, runs } = build();
    await service.scenario('org-1', 'u-1', { salesChange: -0.2, collectionDelayDays: 999 });
    expect(runs.request).toHaveBeenCalledWith('org-1', 'SCENARIO', 'MANUAL', 'u-1', expect.objectContaining({
      scenario: { salesChange: -0.2, collectionDelayDays: 180, extraMonthlyExpense: 0, oneOffAmount: 0, oneOffDay: 0 },
    }));
    await expect(service.scenario('org-1', 'u-1', {})).rejects.toMatchObject({ messageKey: 'ai.cashflow.scenario_empty' });
  });

  it('without a cash source there is no projection, rather than one from zero', async () => {
    const runs = { request: jest.fn() };
    const service = new CashflowService(runs as never, new CashPositionRegistry(), {} as never, {} as never, {} as never);
    await expect(service.refresh('org-1', null)).rejects.toMatchObject({ messageKey: 'ai.cashflow.cash_position_unavailable' });
    expect(runs.request).not.toHaveBeenCalled();
  });

  it('bounds every input', () => {
    expect(boundScenario({ salesChange: -9, oneOffDay: 1000, extraMonthlyExpense: -5, oneOffAmount: Number.NaN })).toEqual({
      salesChange: -1, collectionDelayDays: 0, extraMonthlyExpense: 0, oneOffAmount: 0, oneOffDay: 365,
    });
  });
});
