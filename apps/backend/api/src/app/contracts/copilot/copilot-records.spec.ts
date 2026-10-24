import { recordsIn } from './copilot-tools.contract';

describe('recordsIn', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';

  it('finds the records in a result, labelled by number or name, linked where they open', () => {
    const result = { total: 2, items: [{ id: a, invoiceNumber: 'FAC-1', customer: { id: b, name: 'Ana' } }, { id: a, invoiceNumber: 'FAC-1' }] };
    expect(recordsIn('list_invoices', 'invoice', result)).toEqual([
      { tool: 'list_invoices', type: 'invoice', id: a, label: 'FAC-1', link: `/invoices/${a}` },
      { tool: 'list_invoices', type: 'invoice', id: b, label: 'Ana', link: `/invoices/${b}` },
    ]);
  });

  it('ignores ids that are not record ids, and stops at the limit', () => {
    expect(recordsIn('t', 'product', { items: [{ id: 'x-1', name: 'n' }] })).toEqual([]);
    const many = Array.from({ length: 40 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, sku: `S${index}` }));
    expect(recordsIn('t', 'product', many, 5)).toHaveLength(5);
  });
});
