import { FixedAssetClosingBlockersProvider } from './fixed-asset-closing-blockers.provider';
import type { DepreciationRunResult } from './depreciation.service';
import type { ReconciliationReport } from './capitalization.service';

/**
 * What the fixed-asset register brings to the period's close (audit 2026-11-07, FINB-15): what the
 * close will charge — it runs the depreciation itself —, which assets it cannot charge, and whether
 * the register agrees with the ledger on the period's last day.
 */
describe('FixedAssetClosingBlockersProvider', () => {
  const period = { organizationId: 'org-1', periodId: 'period-1', startDate: '2026-03-01', endDate: '2026-03-31' };
  const preview = (overrides: Partial<DepreciationRunResult> = {}): DepreciationRunResult => ({
    periodEnd: '2026-03-31',
    runId: null,
    journalEntryId: null,
    total: 0,
    assets: [],
    skipped: [],
    tax: { total: 0, assets: [] },
    postable: true,
    notPostable: null,
    ...overrides,
  });
  const report = (overrides: Partial<ReconciliationReport> = {}): ReconciliationReport => ({
    asOf: '2026-03-31',
    accounts: [{ accountId: 'a', code: '1504', name: { es: 'Equipos' }, role: 'COST', assets: 2, register: 300, ledger: 300, difference: 0, untraced: 0, unlinked: 0 }],
    totals: { register: 300, ledger: 300, difference: 0, untraced: 0, unlinked: 0 },
    counts: { unlinkedAssets: 0, untracedPostings: 0 },
    ...overrides,
  });

  const build = (assets: number, run: DepreciationRunResult, reconciliation: ReconciliationReport) => {
    const query = jest.fn().mockResolvedValue([{ count: assets }]);
    const registry = { register: jest.fn() };
    const provider = new FixedAssetClosingBlockersProvider(
      { manager: { query } } as never,
      { preview: jest.fn().mockResolvedValue(run) } as never,
      { reconciliation: jest.fn().mockResolvedValue(reconciliation) } as never,
      registry as never,
    );
    return { provider, registry, query };
  };

  it('registers with the close, and says nothing for a company with no fixed asset by then', async () => {
    const { provider, registry, query } = build(0, preview(), report());
    provider.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(provider);
    expect(await provider.blockersFor(period)).toEqual([]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('"acquisition_date" <= $2::date'), ['org-1', '2026-03-31']);
  });

  it('says what the close will charge: the close posts it, nothing to tick by hand', async () => {
    const { provider } = build(3, preview({ total: 4_500, assets: [{ id: 'x', number: 'AF-1', name: 'A', months: 1, amount: 4_500 }] }), report());
    const [charge, register] = await provider.blockersFor(period);
    expect(charge).toEqual({
      id: 'fixed-assets-depreciation',
      descriptionKey: 'fixed_assets.closing.depreciation_ready',
      params: { count: 1, amount: 4_500 },
      isCompleted: true,
      details: { pendingCount: 0 },
      resolutionLink: '/accounting/fixed-assets/depreciation?period=2026-03',
    });
    expect(register).toMatchObject({ id: 'fixed-assets-reconciliation', descriptionKey: 'fixed_assets.closing.register_reconciled', isCompleted: true });
    expect(register.noteKey).toBeUndefined();
  });

  it('names the assets the close cannot charge, and stops there', async () => {
    const skipped = Array.from({ length: 7 }, (_, index) => ({ id: `s${index}`, number: `AF-${index + 1}`, name: 'x', reason: 'missing_accounts' as const }));
    const { provider } = build(7, preview({ skipped }), report());
    const [charge] = await provider.blockersFor(period);
    expect(charge).toMatchObject({
      descriptionKey: 'fixed_assets.closing.depreciation_skipped',
      params: { count: 7, assets: 'AF-1, AF-2, AF-3, AF-4, AF-5…' },
      isCompleted: false,
      details: { pendingCount: 7 },
    });
  });

  it('says there is nothing to charge when every asset is charged through the period', async () => {
    const { provider } = build(2, preview(), report());
    const [charge] = await provider.blockersFor(period);
    expect(charge).toEqual({ id: 'fixed-assets-depreciation', descriptionKey: 'fixed_assets.closing.depreciation_nothing', isCompleted: true, details: { pendingCount: 0 } });
  });

  it('does not take a difference of zero for agreement: what explains it must be zero too', async () => {
    const byChance = report({
      accounts: [{ accountId: 'a', code: '1504', name: { es: 'Equipos' }, role: 'COST', assets: 2, register: 300, ledger: 300, difference: 0, untraced: 20, unlinked: 20 }],
      totals: { register: 300, ledger: 300, difference: 0, untraced: 20, unlinked: 20 },
      counts: { unlinkedAssets: 1, untracedPostings: 1 },
    });
    const { provider } = build(2, preview(), byChance);
    const [, register] = await provider.blockersFor(period);
    expect(register).toEqual({
      id: 'fixed-assets-reconciliation',
      descriptionKey: 'fixed_assets.closing.register_not_reconciled',
      params: { date: '2026-03-31', difference: 0, unlinked: 1, untraced: 1 },
      isCompleted: false,
      noteKey: 'fixed_assets.closing.register_note',
      details: { pendingCount: 2 },
      resolutionLink: '/accounting/fixed-assets/reconciliation?asOf=2026-03-31',
    });
  });
});
