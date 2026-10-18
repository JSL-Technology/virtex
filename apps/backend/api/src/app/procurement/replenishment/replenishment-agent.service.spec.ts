import { ReorderSuggestionRegistry } from '../../contracts/ai/reorder-suggestions.contract';
import { ReplenishmentAgentService } from './replenishment-agent.service';

describe('the replenishment agent', () => {
  const setup = (settings: Record<string, unknown>, open: Array<{ product_id: string; open: string }> = []) => {
    const registry = new ReorderSuggestionRegistry();
    registry.provide({
      suggestions: async () => ({
        computedAt: new Date('2026-10-18T02:30:00Z'),
        items: [
          { productId: 'p1', warehouseId: 'w1', branchId: null, suggestedQty: 10, onHand: 1, stockoutDate: '2026-10-22', leadTimeDays: 5, status: 'STOCKOUT_RISK' },
          { productId: 'p2', warehouseId: 'w1', branchId: null, suggestedQty: 3, onHand: 0, stockoutDate: '2026-10-30', leadTimeDays: 5, status: 'REORDER' },
        ],
      }),
    });
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('DISTINCT ON')) {
          return [{ product_id: 'p1', supplier_id: 's1', unit_price: '120', tax_rate: '0.18', currency_code: 'DOP', unit_of_measure: 'UND' }];
        }
        if (sql.includes('SUM(')) return open;
        return [{ id: 'p1', name: 'Arroz 5 lb' }, { id: 'p2', name: 'Aceite' }];
      }),
    };
    const repo = {
      findOne: jest.fn(async () => ({ organizationId: 'org', enabled: true, warehouseIds: [], submitForApproval: false, maxOrderAmount: null, ...settings })),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const orders = {
      create: jest.fn(async (dto: { lines: unknown[] }) => ({ id: 'po-1', number: 'OC-2026-000001', lines: dto.lines })),
      submit: jest.fn(async () => ({})),
    };
    const log = { record: jest.fn(async () => 'run-1') };
    const service = new ReplenishmentAgentService(
      dataSource as never,
      repo as never,
      orders as never,
      registry,
      { checkFeature: async () => true } as never,
      { runOnce: async (_n: string, _k: string, fn: () => Promise<void>) => fn() } as never,
      log as never,
    );
    return { service, orders, log };
  };

  it('drafts an order to the last supplier and reports what it could not order', async () => {
    const { service, orders, log } = setup({});
    const result = await service.run('org', null, 'SCHEDULED');

    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({ supplierId: 's1', currencyCode: 'DOP', lines: [expect.objectContaining({ productId: 'p1', description: 'Arroz 5 lb', quantity: 10, unitPrice: 120, taxRate: 0.18 })] }),
      'org',
      null,
    );
    expect(orders.submit).not.toHaveBeenCalled();
    expect(result).toMatchObject({ runId: 'run-1', orders: [{ label: 'OC-2026-000001', state: 'DRAFT' }], skipped: { noSupplier: 1, alreadyOnOrder: 0 } });
    expect(log.record).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'replenishment', status: 'SUCCEEDED', notes: [expect.objectContaining({ key: 'no_supplier', params: expect.objectContaining({ products: 'Aceite' }) })] }),
    );
  });

  it('sends for approval within the limit, and leaves a larger order as a draft', async () => {
    const within = setup({ submitForApproval: true, maxOrderAmount: 5000 });
    await within.service.run('org', 'u1', 'MANUAL');
    expect(within.orders.submit).toHaveBeenCalledWith('po-1', 'org', 'u1');

    const over = setup({ submitForApproval: true, maxOrderAmount: 500 });
    const result = await over.service.run('org', 'u1', 'MANUAL');
    expect(over.orders.submit).not.toHaveBeenCalled();
    expect(result.orders[0].state).toBe('DRAFT');
  });

  it('orders nothing already on order, and says so', async () => {
    const { service, orders, log } = setup({}, [{ product_id: 'p1', open: '10' }]);
    const result = await service.run('org', null, 'SCHEDULED');
    expect(orders.create).not.toHaveBeenCalled();
    expect(result.skipped.alreadyOnOrder).toBe(1);
    expect(log.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'NOTHING_TO_DO' }));
  });
});
