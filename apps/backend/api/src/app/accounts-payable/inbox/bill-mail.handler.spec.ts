import { BillMailHandler, draftFrom, reviewReasons } from './bill-mail.handler';
import { BillCaptureSuggestion } from '../bill-capture.service';
import { InboundMailHandlerRegistry, InboundMailMessage } from '../../contracts/inbound-mail/inbound-mail.contract';
import { fakeTenantDataSource } from '../../shared/tenancy/testing';

const suggestion = (overrides: Partial<BillCaptureSuggestion> = {}): BillCaptureSuggestion =>
  ({
    attachment: { id: 'att-1', fileName: 'f.pdf', mimeType: 'application/pdf' },
    documentKind: 'invoice',
    market: { countryCode: 'DO', generic: false, documentKind: 'NCF' },
    supplier: { match: { id: 'sup-1', name: 'Distribuidora', taxId: '131246753' }, name: 'Distribuidora', taxId: '131246753', taxIdValid: true, registry: null },
    bill: { ncf: 'B0100000123', ncfModified: null, date: '2026-10-05', dueDate: null, currencyCode: 'DOP', paymentForm: null, purchaseCategory: '09', taxAmount: 1033.2, serviceCharge: null, subtotal: 5740, total: 6773.2 },
    lines: [{ description: 'Cemento', quantity: 10, unitPrice: 574, total: 5740, productId: 'cement', expenseAccountId: null, matchedBy: 'history' }],
    checks: { ncf: { status: 'ok', error: null, type: 'B01', warnings: [] }, arithmetic: [], duplicateBillId: null, sameFileBillId: null },
    confidence: { supplier: 1, ncf: 1, dates: 1, amounts: 1, lines: 1 },
    ...overrides,
  }) as BillCaptureSuggestion;

const message: InboundMailMessage = {
  id: 'msg-1',
  organizationId: 'org-1',
  purpose: 'BILLS',
  from: 'ana@supplier.com',
  fromName: null,
  subject: 'Factura',
  text: '',
  receivedAt: new Date(),
  attachments: [{ id: 'a', fileName: 'f.pdf', mimeType: 'application/pdf', size: 5, read: async () => Buffer.from('%PDF-') }],
  mailboxOwnerUserId: null,
};

function build(read: BillCaptureSuggestion, poRows: unknown[] = []) {
  const dataSource = fakeTenantDataSource();
  (dataSource as unknown as { query: unknown }).query = jest.fn(async () => poRows);
  const capture = { capture: jest.fn(async () => read) };
  const bills = { create: jest.fn(async () => ({ id: 'bill-1', ncf: 'B0100000123' })) };
  const handler = new BillMailHandler(
    new InboundMailHandlerRegistry(),
    capture as never,
    bills as never,
    { checkFeature: async () => true } as never,
    { available: () => true } as never,
    dataSource,
  );
  return { handler, capture, bills };
}

describe('BillMailHandler', () => {
  it('turns a bill nothing is in doubt about into a draft, linked to the order it is clearly for', async () => {
    const { handler, bills, capture } = build(suggestion(), [
      { id: 'po-1', number: 'OC-1', total: '5740', line_id: 'pol-1', product_id: 'cement', quantity: '10', billed_quantity: '0', unit_price: '574' },
    ]);
    const outcome = await handler.handle(message);
    expect(capture.capture).toHaveBeenCalledWith('org-1', null, expect.objectContaining({ fileName: 'f.pdf' }), { kind: 'mail', inboundMessageId: 'msg-1' });
    expect(outcome).toEqual({ status: 'PROCESSED', records: [{ type: 'vendor_bill', id: 'bill-1', label: 'B0100000123', link: '/accounts-payable/bill-1' }] });
    const [dto, , actor] = bills.create.mock.calls[0] as unknown as [Record<string, unknown>, string, unknown];
    expect(dto).toMatchObject({ vendorId: 'sup-1', purchaseOrderId: 'po-1', dueDate: '2026-10-05', attachmentIds: ['att-1'] });
    expect((dto['lines'] as Array<Record<string, unknown>>)[0]).toMatchObject({ productId: 'cement', purchaseOrderLineId: 'pol-1' });
    expect(actor).toBeNull();
  });

  it('leaves anything in doubt for a person, with what was read', async () => {
    const { handler, bills } = build(suggestion({ supplier: { match: null, name: 'Nuevo', taxId: '131246753', taxIdValid: true, registry: null } }));
    const outcome = await handler.handle(message);
    expect(bills.create).not.toHaveBeenCalled();
    expect(outcome.status).toBe('NEEDS_REVIEW');
    expect((outcome.review as { bills: Array<{ reasons: string[] }> }).bills[0].reasons).toEqual(['unknown_supplier']);
  });

  it('rejects a message with no document to read', async () => {
    const { handler } = build(suggestion());
    expect(await handler.handle({ ...message, attachments: [] })).toMatchObject({ status: 'REJECTED', reason: 'inbound_mail.no_document' });
  });

  it('names every reason a read bill needs a person', () => {
    const doubtful = suggestion({
      documentKind: 'receipt',
      checks: { ncf: { status: 'invalid', error: 'format', type: null, warnings: [] }, arithmetic: [{ kind: 'subtotal_tax_vs_total', computed: 1, total: 2 }], duplicateBillId: 'b', sameFileBillId: null },
      lines: [{ description: 'x', quantity: 1, unitPrice: 1, total: 1, productId: null, expenseAccountId: null, matchedBy: null }],
    });
    expect(reviewReasons(doubtful)).toEqual(['not_a_bill', 'possible_duplicate', 'document_number', 'arithmetic', 'unmatched_lines']);
    expect(draftFrom(suggestion(), null)).not.toHaveProperty('purchaseOrderId');
  });
});
