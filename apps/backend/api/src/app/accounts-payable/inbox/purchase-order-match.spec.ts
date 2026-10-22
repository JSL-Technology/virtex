import { matchPurchaseOrder } from './purchase-order-match';

const order = (id: string, total: number, lines: Array<[string, number, number]>, unbilled = total) => ({
  id,
  number: `OC-${id}`,
  total,
  unbilled,
  lines: lines.map(([productId, quantity, billedQuantity], index) => ({ id: `${id}-${index}`, productId, quantity, billedQuantity })),
});

describe('matchPurchaseOrder', () => {
  it('links the order whose total and products explain the bill, line by line', () => {
    const match = matchPurchaseOrder(
      [order('1', 5740, [['cement', 10, 0], ['rebar', 4, 0]]), order('2', 900, [['paint', 3, 0]])],
      { total: 5740, lines: [{ productId: 'cement', quantity: 10 }, { productId: 'rebar', quantity: 4 }] },
    );
    expect(match).toMatchObject({ orderId: '1', score: 1, lineMap: { 0: '1-0', 1: '1-1' } });
  });

  it('matches a partial bill against what is left to bill', () => {
    const match = matchPurchaseOrder([order('1', 10000, [['cement', 20, 10]], 5000)], { total: 5000, lines: [{ productId: 'cement', quantity: 10 }] });
    expect(match?.orderId).toBe('1');
  });

  it('leaves two orders that fit equally well for a person', () => {
    const lines: Array<[string, number, number]> = [['cement', 10, 0]];
    expect(matchPurchaseOrder([order('1', 4500, lines), order('2', 4500, lines)], { total: 4500, lines: [{ productId: 'cement', quantity: 10 }] })).toBeNull();
  });

  it('does not link on a weak resemblance', () => {
    expect(matchPurchaseOrder([order('1', 9000, [['paint', 1, 0]])], { total: 4500, lines: [{ productId: 'cement', quantity: 10 }] })).toBeNull();
    expect(matchPurchaseOrder([], { total: 1, lines: [] })).toBeNull();
  });
});
