import { SaasService } from './saas.service';
import { LimitType } from './entities/plan-limit.entity';
import { QuotaPeriod } from './enums/quota-period.enum';

/**
 * The billing screen's usage (QA M-10: «0/∞» for invoices, customers… with real data). Lifetime
 * resources were only ever corrected by the nightly recount, so they read 0 all day.
 */
describe('SaaS usage report', () => {
  const org = {
    id: 'org-1',
    subscriptionPeriodStart: null,
    subscriptionPeriodEnd: null,
    gracePeriodEnd: null,
    plan: {
      slug: 'pro',
      limits: [
        { resource: 'customers', valueType: LimitType.NUMERIC, limit: 500, isUnlimited: false, period: QuotaPeriod.LIFETIME },
        { resource: 'invoices', valueType: LimitType.NUMERIC, limit: -1, isUnlimited: true, period: QuotaPeriod.MONTHLY },
        { resource: 'subsidiaries', valueType: LimitType.BOOLEAN, isEnabled: true, period: QuotaPeriod.LIFETIME },
      ],
    },
  };
  const query = jest.fn(async (sql: string, _params?: unknown[]) => [{ n: sql.includes('FROM customers') ? 42 : 7 }]);
  const usageRepository = {
    createQueryBuilder: () => ({
      where: () => ({ andWhere: () => ({ getMany: async () => [{ resource: 'invoices', period: new Date().toISOString().slice(0, 7), count: 9 }] }) }),
    }),
  };
  const service = new SaasService(
    {} as never, {} as never, {} as never,
    { findOne: jest.fn(async () => org) } as never,
    usageRepository as never,
    {} as never, { get: jest.fn() } as never, { emit: jest.fn() } as never, {} as never,
    { query } as never,
    {} as never, {} as never, {} as never,
  );

  it('counts lifetime resources from the rows, not from a counter only the night job fixes', async () => {
    const usage = await service.getUsage('org-1');
    expect(usage.find((u) => u.resource === 'customers')).toMatchObject({ used: 42, limit: 500, isUnlimited: false });
  });

  it('shows the larger of the counter and the period’s rows for activity quotas', async () => {
    const usage = await service.getUsage('org-1');
    // Counter 9, rows 7: the counter is what enforcement reads, so it is not hidden.
    expect(usage.find((u) => u.resource === 'invoices')).toMatchObject({ used: 9, isUnlimited: true });
    const [, params] = query.mock.calls.find(([sql]) => sql.includes('FROM invoices'))!;
    expect(params?.[0]).toBe('org-1');
  });

  it('reports a feature as included or not', async () => {
    const usage = await service.getUsage('org-1');
    expect(usage.find((u) => u.resource === 'subsidiaries')).toMatchObject({ type: 'boolean', isEnabled: true });
  });
});
