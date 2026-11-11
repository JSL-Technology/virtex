import { BillCaptureService, arithmeticIssues, captureSchema, marketBrief, parseExtractedBill } from './bill-capture.service';
import { purchaseCaptureProfile } from '../markets';

const DO = purchaseCaptureProfile('DO');
const US = purchaseCaptureProfile('US');
const MX = purchaseCaptureProfile('MX');

/**
 * A bill read from a photo is a suggestion checked by arithmetic, not by trust: the supplier
 * identifier's check digit, the document number's shape, the totals, a duplicate already entered —
 * and the supplier is found by their identifier, never by the name the model read.
 *
 * Every rule here belongs to the company's own market: which identifier, which document number,
 * which coded lists. The model is told that market's rules and offered that market's codes only.
 */
const read = (overrides: Record<string, unknown> = {}, profile = DO) =>
  parseExtractedBill({
    documentKind: 'invoice',
    supplierName: 'Distribuidora Caribe SRL',
    supplierTaxId: '1-01-01234-5',
    supplierFiscalNumber: 'b01-00000123',
    modifiedSupplierFiscalNumber: null,
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
    currencyCode: 'dop',
    paymentMethodCode: '04',
    fiscalAttributes: { purchaseCategory: '06' },
    lines: [
      { description: 'Café molido 1lb', code: 'CAF-1', quantity: 10, unitPrice: 250, amount: 2500 },
      { description: 'Azúcar', code: null, quantity: 5, unitPrice: 100, amount: 500 },
    ],
    subtotal: 3000,
    taxAmount: 540,
    serviceCharge: null,
    total: 3540,
    confidence: { supplier: 0.9, document: 0.95, dates: 0.9, amounts: 0.9, lines: 0.8 },
    ...overrides,
  }, profile);

function build({ supplier = null as null | { id: string; name: string; taxId: string }, duplicate = false, registryName = null as string | null } = {}) {
  const queries: string[] = [];
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('FROM "vendor_bills"') && sql.includes('"supplier_fiscal_number"')) return duplicate ? [{ id: 'bill-old' }] : [];
      if (sql.includes('"vendor_bill_line"')) return [{ product: 'azúcar', product_id: null, expense_account_id: 'acc-supplies' }];
      if (sql.includes('"sku"')) return [{ id: 'prod-coffee', sku: 'CAF-1', barcode: null }];
      return [];
    }),
  };
  const suppliers = { findByTaxId: jest.fn(async () => supplier) };
  const registry = { lookupTaxId: jest.fn(async () => ({ found: !!registryName, legalName: registryName, status: 'ACTIVO' })) };
  const attachments = { findOne: jest.fn(async () => null) };
  const service = new BillCaptureService({} as never, {} as never, suppliers as never, registry as never, dataSource as never, attachments as never);
  const attachment = { id: 'att-1', fileName: 'f.jpg', mimeType: 'image/jpeg', sha256: 'x'.repeat(64), vendorBillId: null } as never;
  return { service, suppliers, registry, attachment, queries };
}

describe('BillCaptureService.review', () => {
  // 101012345 is not a valid RNC; 131246753 is (check digit 4).
  it('finds the supplier by RNC and normalises what was read', async () => {
    const { service, attachment, suppliers } = build({ supplier: { id: 'sup-1', name: 'Caribe', taxId: '131246753' } });
    const result = await service.review('org-1', attachment, read({ supplierTaxId: '1-31-24675-3' }), DO);
    expect(suppliers.findByTaxId).toHaveBeenCalledWith('org-1', '131246753');
    expect(result.supplier.match).toEqual({ id: 'sup-1', name: 'Caribe', taxId: '131246753' });
    expect(result.bill).toMatchObject({
      supplierFiscalNumber: 'B0100000123',
      currencyCode: 'DOP',
      paymentMethodCode: '04',
      fiscalAttributes: { purchaseCategory: '06' },
    });
    expect(result.checks.supplierDocument).toMatchObject({ status: 'ok', type: 'B01' });
    expect(result.checks.arithmetic).toEqual([]);
  });

  it('does not look up an RNC whose check digit is wrong, and says so', async () => {
    const { service, attachment, suppliers, registry } = build();
    const result = await service.review('org-1', attachment, read({ supplierTaxId: '101012345' }), DO);
    expect(result.supplier.taxIdValid).toBe(false);
    expect(suppliers.findByTaxId).not.toHaveBeenCalled();
    expect(registry.lookupTaxId).not.toHaveBeenCalled();
  });

  it('asks the registry about a valid RNC the company has no supplier for', async () => {
    const { service, attachment } = build({ registryName: 'DISTRIBUIDORA CARIBE SRL' });
    const result = await service.review('org-1', attachment, read({ supplierTaxId: '131246753' }), DO);
    expect(result.supplier.match).toBeNull();
    expect(result.supplier.registry).toEqual({ legalName: 'DISTRIBUIDORA CARIBE SRL', status: 'ACTIVO' });
  });

  it('flags a bill already entered with the same document number', async () => {
    const { service, attachment } = build({ supplier: { id: 'sup-1', name: 'Caribe', taxId: '131246753' }, duplicate: true });
    const result = await service.review('org-1', attachment, read({ supplierTaxId: '131246753' }), DO);
    expect(result.checks.duplicateBillId).toBe('bill-old');
  });

  it('reports a malformed document number instead of passing it on as valid', async () => {
    const { service, attachment } = build();
    const result = await service.review('org-1', attachment, read({ supplierFiscalNumber: 'B01-123' }), DO);
    expect(result.checks.supplierDocument).toMatchObject({ status: 'invalid', error: 'format' });
  });

  it('matches lines from what was booked before, then by item code', async () => {
    const { service, attachment } = build({ supplier: { id: 'sup-1', name: 'Caribe', taxId: '131246753' } });
    const result = await service.review('org-1', attachment, read({ supplierTaxId: '131246753' }), DO);
    expect(result.lines[0]).toMatchObject({ productId: 'prod-coffee', matchedBy: 'code', total: 2500 });
    expect(result.lines[1]).toMatchObject({ productId: null, expenseAccountId: 'acc-supplies', matchedBy: 'history' });
  });
});

describe('arithmeticIssues', () => {
  it('accepts a bill that adds up, including the 10 % legal service charge', () => {
    expect(arithmeticIssues({ subtotal: 1000, taxAmount: 180, serviceCharge: 100, total: 1280 }, [{ total: 1000 }])).toEqual([]);
  });

  it('reports lines that do not reach the subtotal, and a total that is not subtotal plus tax', () => {
    expect(arithmeticIssues({ subtotal: 1000, taxAmount: 180, serviceCharge: null, total: 1200 }, [{ total: 900 }])).toEqual([
      { kind: 'lines_vs_subtotal', lines: 900, subtotal: 1000 },
      { kind: 'subtotal_tax_vs_total', computed: 1180, total: 1200 },
    ]);
  });
});

describe('parseExtractedBill', () => {
  it('turns anything malformed into null rather than into a field value', () => {
    const parsed = parseExtractedBill(
      {
        issueDate: '01/10/2026',
        currencyCode: 'pesos',
        total: -5,
        paymentMethodCode: 'bitcoin',
        // A code the market does not publish for a field it does ask about: dropped, not guessed.
        fiscalAttributes: { purchaseCategory: '99', invented: '01' },
        lines: 'x',
      },
      DO,
    );
    expect(parsed).toMatchObject({ issueDate: null, currencyCode: null, total: null, paymentMethodCode: null, lines: [] });
    expect(parsed.fiscalAttributes).toMatchObject({ purchaseCategory: null });
    expect(parsed.fiscalAttributes['invented']).toBeUndefined();
  });
});

describe('bill capture, market by market', () => {
  it('reads a US bill by US rules: an EIN is valid, the invoice number is kept unverified, no borrowed codes', async () => {
    const { service, attachment, suppliers } = build({ supplier: { id: 'sup-us', name: 'ACME', taxId: '12-3456789' } });
    const usRead = read(
      {
        supplierTaxId: '12-3456789',
        supplierFiscalNumber: 'INV-20931',
        paymentMethodCode: '04',
        fiscalAttributes: { purchaseCategory: '06' },
        serviceCharge: 5,
        currencyCode: 'usd',
      },
      US,
    );
    // Another market's codes do not survive being read for this one.
    expect(usRead).toMatchObject({ paymentMethodCode: null, fiscalAttributes: {}, serviceCharge: null });
    const result = await service.review('org-1', attachment, usRead, US);
    expect(result.market).toEqual({ countryCode: 'US', generic: false, documentKind: 'INVOICE_NUMBER' });
    expect(result.supplier.taxIdValid).toBe(true);
    expect(suppliers.findByTaxId).toHaveBeenCalledWith('org-1', '123456789');
    expect(result.checks.supplierDocument).toMatchObject({ status: 'unverified', error: null });
    expect(result.bill).toMatchObject({
      supplierFiscalNumber: 'INV-20931',
      paymentMethodCode: null,
      fiscalAttributes: {},
      currencyCode: 'USD',
    });
  });

  it('checks a Mexican bill by its CFDI UUID and SAT payment forms', async () => {
    const { service, attachment } = build();
    const good = await service.review(
      'org-1',
      attachment,
      read({ supplierTaxId: null, supplierFiscalNumber: '6f8b1c2a-1234-4abc-9def-0123456789ab', paymentMethodCode: '03' }, MX),
      MX,
    );
    expect(good.checks.supplierDocument).toMatchObject({ status: 'ok' });
    expect(good.bill).toMatchObject({ supplierFiscalNumber: '6F8B1C2A-1234-4ABC-9DEF-0123456789AB', paymentMethodCode: '03' });
    const bad = await service.review('org-1', attachment, read({ supplierFiscalNumber: 'B0100000123' }, MX), MX);
    expect(bad.checks.supplierDocument).toMatchObject({ status: 'invalid', error: 'format' });
  });

  it('a market with no pack is generic: nothing checked, nothing borrowed from another market', async () => {
    const generic = purchaseCaptureProfile('ZZ');
    expect(generic).toMatchObject({
      generic: true,
      paymentForms: [],
      purchaseClassification: false,
      serviceCharge: false,
      fiscalAttributes: [],
    });
    const { service, attachment } = build();
    const result = await service.review('org-1', attachment, read({ supplierTaxId: 'ABC123', supplierFiscalNumber: 'F-001' }, generic), generic);
    expect(result.supplier.taxIdValid).toBeNull();
    expect(result.checks.supplierDocument.status).toBe('unverified');
  });

  it('tells the model the market it reads, and offers only that market\'s codes', () => {
    expect(marketBrief(DO)).toContain('NCF');
    expect(marketBrief(US)).toContain('EIN');
    expect(marketBrief(US)).not.toMatch(/NCF|RNC|DGII|ITBIS/);
    expect(marketBrief(US)).toContain('month first');
    const usSchema = captureSchema(US) as { properties: Record<string, { properties?: Record<string, unknown> }> };
    expect(usSchema.properties['paymentMethodCode']).toEqual({ type: 'null' });
    // The authority asks nothing else about a purchase here: an object with no fields to fill.
    expect(usSchema.properties['fiscalAttributes'].properties).toEqual({});
    const doSchema = captureSchema(DO) as { properties: Record<string, { properties?: Record<string, unknown> }> };
    expect(Object.keys(doSchema.properties['fiscalAttributes'].properties ?? {})).toEqual(['purchaseCategory', 'isrRetentionType']);
  });
});
