import { QuotesService } from './quotes.service';
import { Quote, QuoteStatus } from '../entities/quote.entity';
import { QuoteLine } from '../entities/quote-line.entity';
import { CreateQuoteDto } from '../dto/create-quote.dto';

/**
 * Quotes as a document with a lifecycle (QA M-09). The invoice engine and the database are
 * replaced at their seams; what is under test is what the quote does with them.
 */
describe('QuotesService', () => {
  const ORG = 'org-1';
  const todayIso = new Date().toISOString().slice(0, 10);
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  const computed = {
    lines: [
      { gross: 300, discountAmount: 30, subtotal: 270, documentDiscountAmount: 0, taxableBase: 270, taxAmount: 48.6, exciseAmount: 0, taxRate: 0.18, taxTreatment: 'TAXED', isService: false },
    ],
    subtotal: 270,
    discountTotal: 0,
    taxedTotal: 270,
    exemptTotal: 0,
    goodsTotal: 270,
    servicesTotal: 0,
    tax: 48.6,
    excise: 0,
    serviceCharge: 0,
    taxWithheld: 0,
    incomeTaxWithheld: 0,
    total: 318.6,
    netReceivable: 318.6,
  };

  let stored: Quote;
  const manager = {
    create: jest.fn((_: unknown, data: object) => Object.assign(new Quote(), data)),
    save: jest.fn(async (q: Quote) => Object.assign(q, { id: q.id ?? 'q-new' })),
    findOne: jest.fn(async (entity: unknown): Promise<unknown> => (entity === Quote ? stored : { baseCurrency: 'DOP' })),
    delete: jest.fn(),
    update: jest.fn(async (_: unknown, __: unknown, patch: Partial<Quote>) => {
      Object.assign(stored, patch);
      return { affected: 1 };
    }),
  };
  const quoteRepository = {
    find: jest.fn(),
    update: jest.fn(async (where: { status?: QuoteStatus }, patch: Partial<Quote>) => {
      if (where.status && stored.status !== where.status) return { affected: 0 };
      Object.assign(stored, patch);
      return { affected: 1 };
    }),
  };
  const dataSource = { manager, transaction: jest.fn((work: (m: typeof manager) => unknown) => work(manager)) };
  const invoices = { preview: jest.fn(async (_dto: any, _org: string) => computed), create: jest.fn() };
  const sequences = { getNextNumber: jest.fn(async () => 'COT-2026-000001') };
  const customers = { findOne: jest.fn(async () => ({ id: 'cus-1', paymentTermDays: 15 })) };
  const settings = { findOne: jest.fn(async () => ({ baseCurrency: 'DOP', defaultPaymentTermDays: 30 })) };

  const service = new QuotesService(
    quoteRepository as never,
    settings as never,
    { rateTypeFor: jest.fn(), rateFor: jest.fn() } as never,
    dataSource as never,
    customers as never,
    sequences as never,
    invoices as never,
  );

  const dto = (over: Partial<CreateQuoteDto> = {}): CreateQuoteDto => ({
    customerId: 'cus-1',
    issueDate: todayIso,
    expiryDate: inDays(15),
    lines: [{ productId: 'p-1', description: ' Silla ', quantity: 1.5, unitPrice: 200, discountRate: 0.1 }],
    ...over,
  });

  const quote = (status: QuoteStatus, expiryDate = inDays(10)): Quote =>
    Object.assign(new Quote(), {
      id: 'q-1',
      organizationId: ORG,
      quoteNumber: 'COT-2026-000001',
      status,
      issueDate: todayIso,
      expiryDate,
      currencyCode: 'DOP',
      documentDiscountRate: 0,
      notes: 'Entrega en 5 días',
      customer: { id: 'cus-1', paymentTermDays: 15 },
      lines: [
        Object.assign(new QuoteLine(), { lineOrder: 1, description: 'B', quantity: 2, unitPrice: 10, discountRate: 0, product: null }),
        Object.assign(new QuoteLine(), { lineOrder: 0, description: 'A', quantity: 1.5, unitPrice: 200, discountRate: 0.1, product: { id: 'p-1' } }),
      ],
    });

  beforeEach(() => jest.clearAllMocks());

  it('totals a quote with the invoice engine, tax included', async () => {
    stored = quote(QuoteStatus.DRAFT);
    const saved = await service.create(dto(), ORG, { id: 'user-1' });

    expect(invoices.preview).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus-1', lineItems: [expect.objectContaining({ quantity: 1.5, unitPrice: 200, discountRate: 0.1 })] }),
      ORG,
    );
    expect(saved).toMatchObject({ quoteNumber: 'COT-2026-000001', status: QuoteStatus.DRAFT, subtotal: 270, taxTotal: 48.6, total: 318.6, discountTotal: 30 });
    expect(saved.lines[0]).toMatchObject({ lineOrder: 0, description: 'Silla', quantity: 1.5, taxRate: 0.18, taxAmount: 48.6, lineTotal: 270 });
  });

  it('refuses a validity date before the issue date', async () => {
    await expect(service.create(dto({ expiryDate: inDays(-1) }), ORG, { id: 'u' })).rejects.toMatchObject({
      messageKey: 'sales.quote_expiry_before_issue',
    });
  });

  it('edits only a draft', async () => {
    stored = quote(QuoteStatus.SENT);
    await expect(service.update('q-1', dto(), ORG)).rejects.toMatchObject({ messageKey: 'sales.quote_not_editable' });
  });

  it('walks draft → sent → accepted, recording when', async () => {
    stored = quote(QuoteStatus.DRAFT);
    const sent = await service.markSent('q-1', ORG);
    expect(sent.status).toBe(QuoteStatus.SENT);
    expect(sent.sentAt).toBeInstanceOf(Date);

    stored.status = QuoteStatus.SENT;
    const accepted = await service.accept('q-1', ORG);
    expect(accepted.status).toBe(QuoteStatus.ACCEPTED);
  });

  it('will not accept an expired quote, and says it is expired', async () => {
    stored = quote(QuoteStatus.SENT, inDays(-2));
    expect((await service.findOne('q-1', ORG)).expired).toBe(true);
    await expect(service.accept('q-1', ORG)).rejects.toMatchObject({ messageKey: 'sales.quote_expired_cannot_accept' });
  });

  it('needs a reason to record a rejection', async () => {
    stored = quote(QuoteStatus.SENT);
    await expect(service.reject('q-1', '  ', ORG)).rejects.toMatchObject({ messageKey: 'sales.quote_rejection_reason_required' });
    const rejected = await service.reject('q-1', 'Precio alto', ORG);
    expect(rejected).toMatchObject({ status: QuoteStatus.REJECTED, rejectionReason: 'Precio alto' });
  });

  it('refuses a move its state does not allow', async () => {
    stored = quote(QuoteStatus.INVOICED);
    await expect(service.cancel('q-1', undefined, ORG)).rejects.toMatchObject({ messageKey: 'sales.quote_transition_not_allowed' });
  });

  it('returns lines in the order they were written', async () => {
    stored = quote(QuoteStatus.DRAFT);
    const read = await service.findOne('q-1', ORG);
    expect(read.lines.map((l) => l.description)).toEqual(['A', 'B']);
  });

  it('converts an accepted quote once, with its prices, discounts and the customer’s terms', async () => {
    stored = quote(QuoteStatus.ACCEPTED);
    invoices.create.mockResolvedValueOnce({ id: 'inv-1' });
    await service.convertToInvoice('q-1', ORG);

    const [invoiceDto] = invoices.create.mock.calls[0];
    expect(invoiceDto).toMatchObject({ customerId: 'cus-1', issue: false, notes: 'Entrega en 5 días' });
    expect(invoiceDto.lineItems[0]).toMatchObject({ productId: 'p-1', quantity: 1.5, unitPrice: 200, discountRate: 0.1 });
    expect(invoiceDto.dueDate).toBe(inDays(15));
    expect(stored).toMatchObject({ status: QuoteStatus.INVOICED, invoiceId: 'inv-1' });

    // A second click finds it claimed.
    await expect(service.convertToInvoice('q-1', ORG)).rejects.toMatchObject({
      messageKey: 'sales.quote_quote_number_has_already_invoiced',
    });
  });

  it('gives the quote back when the invoice cannot be created', async () => {
    stored = quote(QuoteStatus.ACCEPTED);
    invoices.create.mockRejectedValueOnce(new Error('sin período abierto'));
    await expect(service.convertToInvoice('q-1', ORG)).rejects.toThrow('sin período abierto');
    expect(stored.status).toBe(QuoteStatus.ACCEPTED);
  });

  it('duplicates as a new draft dated today, valid as long as the original', async () => {
    stored = Object.assign(quote(QuoteStatus.REJECTED, '2026-01-31'), { issueDate: '2026-01-01' });
    await service.duplicate('q-1', ORG, { id: 'user-1' });
    const [sent] = invoices.preview.mock.calls[0] as [any, string];
    expect(sent).toMatchObject({ issueDate: todayIso, dueDate: inDays(30) });
    expect(sent.lineItems.map((l: { description: string }) => l.description)).toEqual(['A', 'B']);
  });
});
