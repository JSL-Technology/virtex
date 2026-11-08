import { DashboardService } from './dashboard.service';
import { AccountRole } from '../contracts/accounting/account-role.contract';

/**
 * IA-B01 / IA-B04 (audit 2026-11-07): the "EBITDA" tile showed the net income, and every income
 * statement KPI added up balances since the tenant was created. Operating EBITDA is the operating
 * result plus depreciation, over the fiscal year to date.
 */
describe('dashboard KPIs', () => {
  // The chart's enums are the accounting module's; their values are spelled out here instead.
  const account = (id: string, type: string, category: string, systemRole: AccountRole | null = null) => ({
    id,
    type,
    category,
    systemRole,
  });
  const accounts = [
    account('sales', 'REVENUE', 'OPERATING_REVENUE'),
    account('interest-income', 'REVENUE', 'NON_OPERATING_REVENUE'),
    account('cogs', 'EXPENSE', 'COST_OF_GOODS_SOLD'),
    account('salaries', 'EXPENSE', 'OPERATING_EXPENSE'),
    account('depreciation', 'EXPENSE', 'OPERATING_EXPENSE', AccountRole.DEPRECIATION_EXPENSE),
    account('interest', 'EXPENSE', 'NON_OPERATING_EXPENSE'),
    account('income-tax', 'EXPENSE', 'NON_OPERATING_EXPENSE'),
    account('bank', 'ASSET', 'CURRENT_ASSET'),
  ];
  // Fiscal-year-to-date movements (debit − credit): revenue negative, expenses positive.
  const ytd = new Map<string, number>([
    ['sales', -100_000],
    ['interest-income', -1_000],
    ['cogs', 40_000],
    ['salaries', 20_000],
    ['depreciation', 5_000],
    ['interest', 3_000],
    ['income-tax', 9_000],
  ]);
  // Balances since inception, which the income statement KPIs must NOT read.
  const lifetime = new Map<string, number>([...ytd].map(([id, v]) => [id, v * 7]));
  lifetime.set('bank', 50_000);

  const movements = jest.fn(async () => [...ytd].map(([accountId, net]) => ({ accountId, debit: Math.max(net, 0), credit: Math.max(-net, 0) })));
  const dataSource = {
    getRepository: () => ({ findOneBy: async () => ({ id: 'ledger-1', isDefault: true }) }),
    query: jest.fn(async () => [{ start: '2026-01-01' }]),
  };
  const cache = { get: async () => undefined, set: async () => undefined };
  const service = new DashboardService(
    { findAllForOrg: async () => accounts } as never,
    {} as never,
    cache as never,
    dataSource as never,
    {} as never,
    {} as never,
    { balancesAsOf: async () => lifetime, movements } as never,
  );

  it('EBITDA is the operating result plus depreciation, not the net income', async () => {
    const result = await service.getEBITDA('org-1');
    // Operating: 100.000 − 40.000 − 20.000 − 5.000 = 35.000; + depreciation 5.000 = 40.000.
    expect(result).toMatchObject({ ebitda: 40_000, operatingIncome: 35_000, depreciation: 5_000 });
    // The net income (100.000 + 1.000 − 77.000 = 24.000) is something else entirely.
    expect(result.ebitda).not.toBe(24_000);
  });

  it('reads the income statement for the fiscal year to date, without the closing entries', async () => {
    const result = await service.getEBITDA('org-1');
    expect(result.periodFrom).toBe('2026-01-01');
    expect(movements).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-01-01', excludeClosingEntries: true }));
  });

  it('the net margin uses the same period (24.000 / 101.000)', async () => {
    const { netMargin } = await service.getNetMargin('org-1');
    expect(netMargin).toBeCloseTo(23.76, 2);
  });
});
