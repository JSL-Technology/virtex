import { matchItem, parseReadOrder } from './order-reading';

const catalogue = [
  { id: 'p1', name: 'Café molido 500 g', sku: 'CAF-500', barcode: '7460000000017', price: 320 },
  { id: 'p2', name: 'Café en grano 1 kg', sku: 'CAF-1K', barcode: null, price: 640 },
  { id: 'p3', name: 'Azúcar refinada 1 kg', sku: 'AZU-1', barcode: null, price: 90 },
];

describe('order reading', () => {
  it('keeps only items with a description and a positive quantity, and a real date', () => {
    const read = parseReadOrder({
      isOrder: true,
      items: [{ description: ' Café molido ', code: null, quantity: 12, unit: 'paquete' }, { description: 'x', code: null, quantity: -1, unit: null }, { description: '', quantity: 3 }],
      requestedDate: '2026-02-31',
      customerReference: 'PO-77',
      notes: null,
    });
    expect(read).toEqual({ isOrder: true, items: [{ description: 'Café molido', code: null, quantity: 12, unit: 'paquete' }], requestedDate: null, customerReference: 'PO-77', notes: null });
  });

  it('matches by code first, then by a clearly better name', () => {
    expect(matchItem({ description: 'lo de siempre', code: 'caf-1k', quantity: 1, unit: null }, catalogue)).toMatchObject({ product: { id: 'p2' }, matchedBy: 'code' });
    expect(matchItem({ description: 'azucar refinada', code: null, quantity: 2, unit: null }, catalogue)).toMatchObject({ product: { id: 'p3' }, matchedBy: 'name' });
    expect(matchItem({ description: 'Café molido 500 g', code: null, quantity: 2, unit: null }, catalogue)).toMatchObject({ product: { id: 'p1' } });
  });

  it('leaves an ambiguous or unknown item unmatched rather than guess', () => {
    expect(matchItem({ description: 'café', code: null, quantity: 1, unit: null }, catalogue).product).toBeNull();
    expect(matchItem({ description: 'tornillos', code: 'ZZZ', quantity: 1, unit: null }, catalogue).product).toBeNull();
  });
});
