import { OrderMailHandler, quoteFrom } from './order-mail.handler';
import { InboundMailHandlerRegistry, InboundMailMessage } from '../../contracts/inbound-mail/inbound-mail.contract';
import { fakeTenantDataSource } from '../../shared/tenancy/testing';

const message: InboundMailMessage = {
  id: 'msg-1',
  organizationId: 'org-1',
  purpose: 'ORDERS',
  from: 'compras@hotel.com',
  fromName: 'Hotel Bávaro',
  subject: 'Pedido semana 43',
  text: 'Favor enviar 12 paquetes de café molido 500 g y 2 sacos de azúcar refinada. Ref PO-77.',
  receivedAt: new Date(),
  attachments: [],
  mailboxOwnerUserId: 'owner-1',
};

const catalogue = [
  { id: 'p1', name: 'Café molido 500 g', sku: 'CAF-500', barcode: null, price: 320 },
  { id: 'p3', name: 'Azúcar refinada 45 kg', sku: 'AZU-45', barcode: null, price: 2100 },
];

function build(customers: unknown[], items: Array<{ description: string; code: string | null; quantity: number; unit: string | null }>, isOrder = true) {
  const dataSource = fakeTenantDataSource();
  const query = jest.fn().mockResolvedValueOnce(customers).mockResolvedValueOnce(catalogue);
  (dataSource as unknown as { query: unknown }).query = query;
  const ai = {
    available: () => true,
    extract: jest.fn(async (request: { validate: (raw: unknown) => unknown }) => ({
      value: request.validate({ isOrder, items, requestedDate: '2026-10-30', customerReference: 'PO-77', notes: null }),
      requestId: 'r',
      model: 'm',
    })),
  };
  const quotes = { create: jest.fn(async () => ({ id: 'q-1', quoteNumber: 'COT-9' })) };
  const handler = new OrderMailHandler(new InboundMailHandlerRegistry(), ai as never, quotes as never, dataSource);
  return { handler, quotes, ai };
}

const items = [
  { description: 'café molido 500 g', code: null, quantity: 12, unit: 'paquete' },
  { description: 'azúcar refinada', code: null, quantity: 2, unit: 'saco' },
];

describe('OrderMailHandler', () => {
  it('turns a recognised customer\'s order into a draft quote at catalogue prices, for the account owner', async () => {
    const { handler, quotes } = build([{ id: 'c-1', name: 'Hotel Bávaro', ownerId: 'rep-1' }], items);
    const outcome = await handler.handle(message);
    expect(outcome).toEqual({ status: 'PROCESSED', records: [{ type: 'quote', id: 'q-1', label: 'COT-9', link: '/quotes/q-1/edit' }] });
    const [dto, org, owner] = quotes.create.mock.calls[0] as unknown as [Record<string, unknown>, string, { id: string }];
    expect(org).toBe('org-1');
    expect(owner).toEqual({ id: 'rep-1' });
    expect(dto['lines']).toEqual([
      { productId: 'p1', description: 'Café molido 500 g', quantity: 12, unitPrice: 320 },
      { productId: 'p3', description: 'Azúcar refinada 45 kg', quantity: 2, unitPrice: 2100 },
    ]);
    expect(dto['notes']).toContain('Ref. PO-77');
  });

  it('leaves an order from an unknown sender, or with an item it cannot place, for a person', async () => {
    const { handler, quotes } = build([], [...items, { description: 'servilletas', code: null, quantity: 5, unit: null }]);
    const outcome = await handler.handle(message);
    expect(quotes.create).not.toHaveBeenCalled();
    const order = (outcome.review as { order: { reasons: string[]; items: Array<{ productId: string | null }> } }).order;
    expect(outcome.status).toBe('NEEDS_REVIEW');
    expect(order.reasons).toEqual(['unknown_customer', 'unmatched_items']);
    expect(order.items.map((item) => item.productId)).toEqual(['p1', 'p3', null]);
  });

  it('drops an e-mail that is not an order', async () => {
    const { handler } = build([{ id: 'c-1', name: 'H', ownerId: null }], [], false);
    expect(await handler.handle(message)).toMatchObject({ status: 'REJECTED', reason: 'inbound_mail.not_an_order' });
  });

  it('prices the quote from the catalogue, never from the e-mail', () => {
    const dto = quoteFrom('c', { isOrder: true, items: [], requestedDate: null, customerReference: null, notes: 'urgente' }, [
      { description: 'x', quantity: 1, unit: null, product: { id: 'p', name: 'P', sku: null, barcode: null, price: 10 }, matchedBy: 'code' },
    ], message, new Date('2026-10-22T00:00:00Z'));
    expect(dto).toMatchObject({ issueDate: '2026-10-22', expiryDate: '2026-11-06', lines: [{ unitPrice: 10 }] });
  });
});
