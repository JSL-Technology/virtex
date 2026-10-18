import { ReorderSuggestion } from '../../contracts/ai/reorder-suggestions.contract';
import { LastPurchase, planReplenishment } from './replenishment-plan';

const suggestion = (productId: string, qty: number, overrides: Partial<ReorderSuggestion> = {}): ReorderSuggestion => ({
  productId,
  warehouseId: 'w1',
  branchId: 'b1',
  suggestedQty: qty,
  onHand: 0,
  stockoutDate: '2026-10-25',
  leadTimeDays: 7,
  status: 'REORDER',
  ...overrides,
});
const bought = (supplierId: string, unitPrice: number): LastPurchase => ({ supplierId, unitPrice, taxRate: 0.18, currencyCode: 'DOP', unitOfMeasure: 'UND' });

describe('replenishment plan', () => {
  const base = {
    warehouseIds: null,
    openQuantity: new Map<string, number>(),
    productNames: new Map([['p1', 'Arroz'], ['p2', 'Aceite'], ['p3', 'Azúcar']]),
    maxOrderAmount: null,
  };

  it('orders from the last supplier at the last price, one order per supplier', () => {
    const plan = planReplenishment({
      ...base,
      suggestions: [suggestion('p1', 10), suggestion('p2', 4.2), suggestion('p3', 5)],
      lastPurchase: new Map([['p1', bought('s1', 100)], ['p2', bought('s1', 50)], ['p3', bought('s2', 30)]]),
    });
    expect(plan.orders).toHaveLength(2);
    const s1 = plan.orders.find((order) => order.supplierId === 's1')!;
    expect(s1.lines.map((line) => [line.description, line.quantity, line.unitPrice])).toEqual([['Arroz', 10, 100], ['Aceite', 5, 50]]);
    expect(s1.amount).toBe(1250);
  });

  it('reports a product never bought instead of guessing a supplier', () => {
    const plan = planReplenishment({ ...base, suggestions: [suggestion('p1', 10)], lastPurchase: new Map() });
    expect(plan.orders).toEqual([]);
    expect(plan.skipped).toEqual([{ productId: 'p1', reason: 'no_supplier' }]);
  });

  it('orders only what is not already on order, so a second run orders nothing twice', () => {
    const lastPurchase = new Map([['p1', bought('s1', 100)]]);
    expect(planReplenishment({ ...base, suggestions: [suggestion('p1', 10)], lastPurchase, openQuantity: new Map([['p1', 4]]) }).orders[0].lines[0].quantity).toBe(6);
    expect(planReplenishment({ ...base, suggestions: [suggestion('p1', 10)], lastPurchase, openQuantity: new Map([['p1', 10]]) }).skipped).toEqual([
      { productId: 'p1', reason: 'already_on_order' },
    ]);
  });

  it('keeps to the chosen warehouses, and flags an order above the limit', () => {
    const plan = planReplenishment({
      ...base,
      warehouseIds: ['w1'],
      maxOrderAmount: 500,
      suggestions: [suggestion('p1', 10), suggestion('p2', 10, { warehouseId: 'w2' })],
      lastPurchase: new Map([['p1', bought('s1', 100)], ['p2', bought('s1', 50)]]),
    });
    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]).toMatchObject({ amount: 1000, withinLimit: false });
  });
});
