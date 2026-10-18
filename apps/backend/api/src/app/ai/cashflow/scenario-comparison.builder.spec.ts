import { AiReport } from '../entities/ai-report.entity';
import { ScenarioComparisonBuilder } from './scenario-comparison.builder';

describe('the scenario comparison', () => {
  const metrics = (endP50: number, shortfall: number) => ({
    horizonDays: 90, endP50, endP10: endP50 - 20_000, lowestP50: endP50 - 30_000, lowestP50Date: '2026-11-14',
    shortfallProbability: shortfall, firstLikelyShortfallDate: shortfall ? '2026-11-10' : null, expectedInflow: 200_000, expectedOutflow: 150_000,
  });
  const scenario = {
    id: 'sc-1', kind: 'SCENARIO', status: 'SUCCEEDED', metrics: metrics(40_000, 0.35),
    params: { baseCurrency: 'DOP', scenario: { salesChange: -0.2, collectionDelayDays: 15, extraMonthlyExpense: 0, oneOffAmount: 0, oneOffDay: 0 } },
  };
  const baseline = { id: 'b-1', kind: 'CASHFLOW', status: 'SUCCEEDED', metrics: metrics(100_000, 0.05) };

  const builder = (found: unknown = scenario) =>
    new ScenarioComparisonBuilder(
      { register: jest.fn() } as never,
      { latestSucceeded: jest.fn(async () => baseline) } as never,
      { findOne: jest.fn(async () => found) } as never,
    );

  it('puts the two projections side by side with the differences already computed', async () => {
    const brief = await builder().build('org-1', { sourceRunId: 'sc-1' } as AiReport);
    expect(brief.sourceRunId).toBe('sc-1');
    expect(brief.facts).toMatchObject({
      currency: 'DOP',
      scenarioInputs: { salesChangePercent: -20, customersPayLaterByDays: 15 },
      differences: { expectedBalanceAtEnd: -60_000, shortfallChancePercentagePoints: 30 },
      withScenario: { shortfallChancePercent: 35 },
      currentProjection: { shortfallChancePercent: 5 },
    });
  });

  it('refuses a scenario that has not finished, or none at all', async () => {
    await expect(builder({ ...scenario, status: 'RUNNING' }).build('org-1', { sourceRunId: 'sc-1' } as AiReport)).rejects.toThrow(/not finished/);
    await expect(builder().build('org-1', { sourceRunId: null } as AiReport)).rejects.toThrow(/needs its scenario/);
  });
});
