import type { CatalogueItem } from '../core/pos-api.service';
import {
  addToCart,
  cartTotals,
  filterCatalogue,
  findByCode,
  isOutOfStock,
  repriceCart,
  setQuantity,
} from './cart';

const item = (over: Partial<CatalogueItem> = {}): CatalogueItem => ({
  id: 'p1',
  name: 'Café 454 g',
  sku: 'CAF-454',
  barcode: '7460321000017',
  price: 385,
  taxRate: 0.18,
  kind: 'GOOD',
  stock: 3,
  unitOfMeasure: 'UND',
  imageUrl: null,
  categoryId: 'c1',
  categoryName: 'Despensa',
  ...over,
});

describe('cart', () => {
  it('prices each line as the server does: per line, rounded to the cent, then summed', () => {
    const lines = addToCart([], item({ price: 0.335, taxRate: 0.18 }), 3).lines;
    // 3 × 0.335 = 1.005 → 1.01 (line-rounded); tax 0.18 × 1.01 = 0.1818 → 0.18
    expect(cartTotals(lines)).toMatchObject({
      subtotal: 1.01,
      tax: 0.18,
      total: 1.19,
      units: 3,
      rate: 0.18,
    });
  });

  it('reports the single rate on the ticket, or null when lines carry different ones', () => {
    let lines = addToCart([], item()).lines;
    lines = addToCart(lines, item({ id: 'p2', taxRate: 0 })).lines;
    expect(cartTotals(lines).rate).toBeNull();
    expect(cartTotals([], 0.16).rate).toBe(0.16);
  });

  it('refuses to sell a good beyond what is on hand, and never limits a service', () => {
    let change = addToCart([], item({ stock: 1 }));
    change = addToCart(change.lines, item({ stock: 1 }));
    expect(change.refused).toEqual({
      reason: 'not_enough_stock',
      available: 1,
    });
    expect(change.lines[0].quantity).toBe(1);

    const service = item({ id: 's', kind: 'SERVICE', stock: 0 });
    expect(isOutOfStock(service)).toBe(false);
    expect(addToCart([], service, 50).refused).toBeUndefined();
  });

  it('setting a quantity of zero removes the line; above stock is refused', () => {
    const lines = addToCart([], item()).lines;
    expect(setQuantity(lines, 'p1', 0).lines).toEqual([]);
    expect(setQuantity(lines, 'p1', 9).refused?.available).toBe(3);
    expect(setQuantity(lines, 'p1', 2).lines[0].quantity).toBe(2);
  });

  it('re-prices open lines from the catalogue and drops products no longer sold', () => {
    let lines = addToCart([], item()).lines;
    lines = addToCart(lines, item({ id: 'gone', name: 'Retirado' })).lines;
    const repriced = repriceCart(lines, [item({ price: 400, taxRate: 0.16 })]);
    expect(repriced).toHaveLength(1);
    expect(repriced[0]).toMatchObject({ price: 400, taxRate: 0.16 });
  });

  it('a scan finds the exact barcode or SKU, case-insensitively', () => {
    const catalogue = [
      item(),
      item({ id: 'p2', sku: 'AGU-600', barcode: null }),
    ];
    expect(findByCode(catalogue, ' 7460321000017 ')?.id).toBe('p1');
    expect(findByCode(catalogue, 'agu-600')?.id).toBe('p2');
    expect(findByCode(catalogue, '746')).toBeUndefined();
  });

  it('filters by name, SKU or barcode within a category', () => {
    const catalogue = [
      item(),
      item({
        id: 'p2',
        name: 'Agua',
        sku: 'AGU',
        barcode: '1',
        categoryId: 'c2',
      }),
    ];
    expect(filterCatalogue(catalogue, 'caf').map((i) => i.id)).toEqual(['p1']);
    expect(filterCatalogue(catalogue, '', 'c2').map((i) => i.id)).toEqual([
      'p2',
    ]);
    expect(filterCatalogue(catalogue, 'caf', 'c2')).toEqual([]);
  });
});
