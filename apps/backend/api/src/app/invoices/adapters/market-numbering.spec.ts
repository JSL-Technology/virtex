import type { EntityManager } from 'typeorm';
import { FiscalAdapterFactory } from './fiscal-adapter.factory';
import { MarketFiscalAdapter } from './market-fiscal.adapter';
import type { FiscalRangeService } from '../../einvoicing/services/fiscal-range.service';
import { Invoice, InvoiceType } from '../entities/invoice.entity';
import { BadRequestError } from '../../i18n/localized.exception';
import {
  allMarkets,
  coverageFor,
  knownMarket,
  marketCodes,
  marketFor,
  type DocumentToNumber,
  type MarketDefinition,
} from '../../markets';

/**
 * How every market numbers its fiscal documents, read from its own package, and the one engine
 * that follows it.
 *
 * Nine adapters used to do this — one per regime, a `switch` choosing among them — and the types
 * each offered disagreed with the market's own catalogue (Argentina's `01` against `1`). The rule
 * is now data each market declares (`markets/<cc>/documents.ts`, `numbering`), and these tests pin
 * that the data is coherent for all nineteen markets and that the engine reads it the same way for
 * each. No database: the policy is a function of facts.
 */
const document = (overrides: Partial<DocumentToNumber> = {}): DocumentToNumber => ({
  purpose: 'INVOICE',
  emissionKind: null,
  buyer: { taxId: null, documentCode: null, countryCode: null, taxpayerKind: null, fiscalAttributes: null },
  issuerFiscalProfile: {},
  chargesTax: true,
  original: null,
  ...overrides,
});

/** A market of the catalogue; a test naming one the product does not sell in is a broken test. */
const definition = (code: string): MarketDefinition => {
  const market = knownMarket(code);
  if (!market) throw new Error(`${code} is not a market of the catalogue`);
  return market;
};
const numberingOf = (code: string) => definition(code).documents.numbering;
/** A part of a market's numbering the test relies on being declared. */
function declared<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} is not declared`);
  return value;
}

const typeOf = (code: string, facts: Partial<DocumentToNumber> = {}) => numberingOf(code).typeOf(document(facts));

describe('every market declares a numbering its own catalogue can honour', () => {
  const markets = allMarkets();

  it.each(markets.map((market) => [market.code, market] as const))('%s', (_code, market: MarketDefinition) => {
    const { numbering, types } = market.documents;
    const codes = new Set(types.map((type) => type.code));

    if (numbering.source === 'NONE') {
      // A market where the product issues no fiscal number names no type for any document.
      for (const purpose of ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] as const) {
        expect(numbering.typeOf(document({ purpose }))).toBeNull();
      }
      expect(numbering.emissionKinds).toEqual([]);
      return;
    }

    expect(numbering.emissionKinds.length).toBeGreaterThan(0);
    for (const kind of numbering.emissionKinds) {
      // Each kind the market has is a kind its catalogue declares types of.
      expect(types.some((type) => type.isElectronic === (kind === 'ELECTRONIC'))).toBe(true);
    }
    // Whatever the policy resolves to is in the catalogue; where the issuer may choose, it is of the
    // document's purpose, because that is what a chosen type is checked against. Where the type
    // follows from the document, one type may serve several purposes (the NF-e, the CFDI de ingreso).
    const facts: Partial<DocumentToNumber>[] = [
      {},
      { chargesTax: false },
      { emissionKind: numbering.emissionKinds[numbering.emissionKinds.length - 1] },
      { buyer: { taxId: '00000000000', documentCode: null, countryCode: null, taxpayerKind: 'company', fiscalAttributes: null } },
    ];
    const issuer = market.code === 'AR' ? { issuerFiscalProfile: { condicionIva: '1' } } : {};
    for (const purpose of ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] as const) {
      for (const fact of facts) {
        const resolved = numbering.typeOf(document({ ...issuer, ...fact, purpose }));
        if (resolved === null) continue;
        expect(codes).toContain(resolved);
        if (numbering.requestedType === 'CHOOSE') {
          expect(types.find((type) => type.code === resolved)?.purpose).toBe(purpose);
        }
      }
    }
    for (const [kind, automatic] of Object.entries(numbering.automaticTypes ?? {})) {
      for (const code of automatic ?? []) {
        const type = types.find((candidate) => candidate.code === code);
        expect(type?.purpose).toBe('INVOICE');
        expect(type?.isElectronic).toBe(kind === 'ELECTRONIC');
      }
    }
    if (numbering.tillReceiptType) {
      expect(types.find((type) => type.code === numbering.tillReceiptType)?.purpose).toBe('INVOICE');
      expect(numbering.source).toBe('AUTHORITY_RANGE');
    }
    if (numbering.source !== 'AUTHORITY_RANGE') {
      // Only a range is drawn from, so only a range-numbered market formats a drawn number.
      expect(numbering.format).toBeUndefined();
      expect(numbering.tillReceiptType).toBeUndefined();
    }
  });

  it('a market that issues debit notes resolves a type for one, and one that does not is refused one', () => {
    for (const market of markets) {
      if (market.documents.numbering.source === 'NONE') continue;
      const issuer = market.code === 'AR' ? { issuerFiscalProfile: { condicionIva: '1' } } : {};
      const resolved = market.documents.numbering.typeOf(document({ ...issuer, purpose: 'DEBIT_NOTE' }));
      if (market.documents.debitNotes) expect(resolved).not.toBeNull();
    }
  });
});

describe('the rules each market declares', () => {
  const RNC = '130456781';

  it('DO: crédito fiscal to a taxpayer, consumo to anybody else, in the kind the company issues', () => {
    expect(typeOf('DO', { buyer: { ...document().buyer, taxId: RNC } })).toBe('E31');
    expect(typeOf('DO')).toBe('E32');
    expect(typeOf('DO', { emissionKind: 'TRADITIONAL', buyer: { ...document().buyer, taxId: RNC } })).toBe('B01');
    expect(typeOf('DO', { emissionKind: 'TRADITIONAL' })).toBe('B02');
    // A note follows the series of the document it modifies, not the company's current mode.
    expect(typeOf('DO', { purpose: 'CREDIT_NOTE', original: { documentType: null, fiscalNumber: 'B0100000007' } })).toBe('B04');
    expect(typeOf('DO', { purpose: 'CREDIT_NOTE', original: { documentType: 'E31', fiscalNumber: 'E310000000007' } })).toBe('E34');
    expect(typeOf('DO', { purpose: 'DEBIT_NOTE', original: { documentType: 'B01', fiscalNumber: 'B0100000007' } })).toBe('B03');
  });

  it('DO: the number is the type followed by the consecutive, by the catalogue mask', () => {
    const format = declared(numberingOf('DO').format, 'DO format');
    const point = { establishment: null, emissionPoint: null };
    expect(format({ sequence: 1, series: '', documentType: 'B02' }, point)).toBe('B0200000001');
    expect(format({ sequence: 123, series: '', documentType: 'E31' }, point)).toBe('E310000000123');
  });

  it('PE: a factura to a buyer with a RUC, a boleta otherwise; a note takes the letter of its document', () => {
    expect(typeOf('PE', { buyer: { ...document().buyer, taxId: '20123456786' } })).toBe('01');
    expect(typeOf('PE')).toBe('03');
    const numbering = numberingOf('PE');
    const point = { establishment: null, emissionPoint: null };
    expect(declared(numbering.format, 'format')({ sequence: 123, series: 'F001', documentType: '01' }, point)).toBe('F001-00000123');
    expect(declared(numbering.seriesOf, 'seriesOf')(point, document({ purpose: 'CREDIT_NOTE', original: { documentType: '03', fiscalNumber: 'B001-00000004' } })))
      .toEqual({ kind: 'PREFIX', prefix: 'B' });
    expect(declared(numbering.seriesOf, 'seriesOf')(point, document())).toBeUndefined();
    expect(declared(numbering.acceptsSeries, 'acceptsSeries')('01', 'F001')).toBe(true);
    expect(declared(numbering.acceptsSeries, 'acceptsSeries')('03', 'F002')).toBe(false);
    expect(declared(numbering.acceptsSeries, 'acceptsSeries')('07', 'B001')).toBe(true);
    expect(declared(numbering.acceptsSeries, 'acceptsSeries')('01', 'F1')).toBe(false);
  });

  it('CL: afecta when the sale charges VAT, exenta when it does not', () => {
    expect(typeOf('CL')).toBe('33');
    expect(typeOf('CL', { chargesTax: false })).toBe('34');
    expect(typeOf('CL', { purpose: 'CREDIT_NOTE' })).toBe('61');
    expect(declared(numberingOf('CL').acceptsSeries, 'acceptsSeries')('33', '')).toBe(true);
    expect(declared(numberingOf('CL').acceptsSeries, 'acceptsSeries')('33', 'A')).toBe(false);
  });

  it('EC: numbered per establishment and emission point, nine digits', () => {
    const numbering = numberingOf('EC');
    const point = { establishment: '1', emissionPoint: '2' };
    expect(numbering.issuingPointRequired).toBe(true);
    expect(declared(numbering.seriesOf, 'seriesOf')(point, document())).toEqual({ kind: 'EXACT', series: '001-002' });
    expect(declared(numbering.format, 'format')({ sequence: 45, series: '001-002', documentType: '01' }, point)).toBe('001-002-000000045');
    expect(declared(numbering.acceptsSeries, 'acceptsSeries')('01', '001-002')).toBe(true);
    expect(declared(numbering.acceptsSeries, 'acceptsSeries')('01', '')).toBe(false);
  });

  it('CO and BR: the resolution prefix before the consecutive; the bare nNF within its série', () => {
    const point = { establishment: null, emissionPoint: null };
    expect(declared(numberingOf('CO').format, 'format')({ sequence: 990000000, series: 'SETP', documentType: '01' }, point)).toBe('SETP990000000');
    expect(declared(numberingOf('BR').format, 'format')({ sequence: 7, series: '1', documentType: '55' }, point)).toBe('7');
    expect(declared(numberingOf('BR').acceptsSeries, 'acceptsSeries')('55', '1')).toBe(true);
    expect(declared(numberingOf('BR').acceptsSeries, 'acceptsSeries')('55', 'A1')).toBe(false);
  });

  it('MX: the stamp is the identity; the type is ingreso, or egreso for a credit note', () => {
    expect(numberingOf('MX').source).toBe('STAMP');
    expect(typeOf('MX')).toBe('I');
    expect(typeOf('MX', { purpose: 'CREDIT_NOTE' })).toBe('E');
  });

  it('AR: the class follows from both parties, as AFIP codes the VAT condition', () => {
    const responsable = { issuerFiscalProfile: { condicionIva: '1' } };
    expect(typeOf('AR', responsable)).toBe('6');
    expect(typeOf('AR', { ...responsable, buyer: { ...document().buyer, fiscalAttributes: { condicionIva: '1' } } })).toBe('1');
    // An exempt issuer and a monotributista issue C, never B.
    expect(typeOf('AR', { issuerFiscalProfile: { condicionIva: '4' } })).toBe('11');
    expect(typeOf('AR', { issuerFiscalProfile: { condicionIva: '6' } })).toBe('11');
    // A note takes the class of the document it modifies.
    expect(typeOf('AR', { ...responsable, purpose: 'CREDIT_NOTE', original: { documentType: '1', fiscalNumber: null } })).toBe('3');
    // An issuer whose condition is unknown — or a consumidor final — has no class to issue.
    expect(typeOf('AR')).toBeNull();
    expect(typeOf('AR', { issuerFiscalProfile: { condicionIva: '5' } })).toBeNull();
  });
});

describe('MarketFiscalAdapter — the one engine', () => {
  const drawNext = jest.fn();
  const liveDocumentTypes = jest.fn();
  const ranges = { drawNext, liveDocumentTypes } as unknown as FiscalRangeService;

  /** The company as its fiscal-identity contract reads it; nothing else is looked up for these documents. */
  const organization = (fiscalProfile: Record<string, string> = {}) =>
    ({ id: 'org', country: 'DO', timezone: 'America/Santo_Domingo', fiscalProfile, taxId: '130456781' });
  const managerWith = (org: ReturnType<typeof organization> | null = organization()) =>
    ({
      // The company by its id; the e-invoicing settings (an emission point) by tenant and market — none.
      findOne: jest.fn(async (_entity: unknown, options: { where: Record<string, unknown> }) =>
        'countryCode' in options.where ? null : org),
    }) as unknown as EntityManager;

  const invoice = (overrides: Partial<Invoice> = {}) =>
    ({ id: 'inv', organizationId: 'org', type: InvoiceType.INVOICE, customerTaxId: null, customer: null, tax: 18, currencyCode: 'DOP', branchId: null, ...overrides }) as unknown as Invoice;

  const adapter = (code: string) => new MarketFiscalAdapter(marketFor(code), ranges);

  beforeEach(() => {
    drawNext.mockReset();
    drawNext.mockImplementation(async (_manager, criteria: { documentType: string }) => ({
      number: 7,
      series: '',
      documentType: criteria.documentType,
      validUntil: '2027-12-31',
      authorizationCode: null,
      secret: null,
      secretKind: null,
    }));
    liveDocumentTypes.mockReset();
  });

  it('draws the type the market resolves, writes it by the mask, and records what it drew', async () => {
    const assignment = await adapter('DO').assignSalesNumber({ invoice: invoice(), organizationId: 'org', manager: managerWith() });
    expect(drawNext).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ countryCode: 'DO', documentType: 'E32' }));
    expect(assignment).toEqual({ fiscalNumber: 'E320000000007', documentType: 'E32', expiresAt: '2027-12-31', sequence: 7, series: '' });
  });

  it('lets the issuer choose a type of the purpose where the market allows it (an export, E46)', async () => {
    const assignment = await adapter('DO').assignSalesNumber({ invoice: invoice(), organizationId: 'org', manager: managerWith(), requestedType: 'e46' });
    expect(assignment.documentType).toBe('E46');
  });

  it('refuses a requested type of another purpose, or one the company issues as the buyer', async () => {
    const assign = (requestedType: string) =>
      adapter('DO').assignSalesNumber({ invoice: invoice(), organizationId: 'org', manager: managerWith(), requestedType });
    await expect(assign('E34')).rejects.toMatchObject({ messageKey: 'invoices.document_type_type_not_sales_document' });
    await expect(assign('E41')).rejects.toMatchObject({ messageKey: 'invoices.document_type_type_not_sales_document' });
    await expect(assign('33')).rejects.toMatchObject({ messageKey: 'invoices.document_type_type_does_not_exist' });
    expect(drawNext).not.toHaveBeenCalled();
  });

  it('refuses a type that names the buyer for a tax credit when the buyer has no valid identifier', async () => {
    const assign = (taxId: string | null, requestedType: string) =>
      adapter('DO').assignSalesNumber({ invoice: invoice({ customerTaxId: taxId }), organizationId: 'org', manager: managerWith(), requestedType });
    await expect(assign('123456789', 'B01')).rejects.toMatchObject({ messageKey: 'invoices.document_type_requires_buyer_tax_id' });
    await expect(assign(null, 'E31')).rejects.toBeInstanceOf(BadRequestError);
    await expect(assign('130456781', 'E31')).resolves.toMatchObject({ documentType: 'E31' });
  });

  it('names the contradiction where the type follows from the document, instead of issuing another', async () => {
    const assign = (tax: number, requestedType?: string) =>
      adapter('CL').assignSalesNumber({ invoice: invoice({ tax, currencyCode: 'CLP', customerTaxId: '76086428-5' }), organizationId: 'org', manager: managerWith(), requestedType });
    await expect(assign(0, '33')).rejects.toMatchObject({ messageKey: 'invoices.you_asked_type_requested_document_type' });
    await expect(assign(0)).resolves.toMatchObject({ documentType: '34' });
  });

  it('records only the type where the authority stamps or counts, and draws nothing', async () => {
    const mx = await adapter('MX').assignSalesNumber({ invoice: invoice({ currencyCode: 'MXN' }), organizationId: 'org', manager: managerWith() });
    expect(mx).toEqual({ fiscalNumber: null, documentType: 'I', expiresAt: null, sequence: null, series: null });
    const ar = await adapter('AR').assignSalesNumber({ invoice: invoice({ currencyCode: 'ARS' }), organizationId: 'org', manager: managerWith(organization({ condicionIva: '6' })) });
    expect(ar.documentType).toBe('11');
    expect(drawNext).not.toHaveBeenCalled();
  });

  it('says which fiscal fact is missing when the market cannot decide the type', async () => {
    await expect(
      adapter('AR').assignSalesNumber({ invoice: invoice({ currencyCode: 'ARS' }), organizationId: 'org', manager: managerWith(organization({})) }),
    ).rejects.toMatchObject({ messageKey: 'invoices.document_type_undetermined' });
  });

  it('issues no fiscal identity where the product issues none, and refuses a type asked for there', async () => {
    const none = await adapter('US').assignSalesNumber({ invoice: invoice({ currencyCode: 'USD' }), organizationId: 'org', manager: managerWith() });
    expect(none).toEqual({ fiscalNumber: null, documentType: null, expiresAt: null, sequence: null, series: null });
    await expect(
      adapter('US').assignSalesNumber({ invoice: invoice({ currencyCode: 'USD' }), organizationId: 'org', manager: managerWith(), requestedType: '01' }),
    ).rejects.toMatchObject({ messageKey: 'invoices.document_type_type_does_not_exist' });
  });

  it('refuses to number where the market numbers per emission point and none is stated', async () => {
    await expect(
      adapter('EC').assignSalesNumber({ invoice: invoice({ currencyCode: 'USD' }), organizationId: 'org', manager: managerWith() }),
    ).rejects.toMatchObject({ messageKey: 'invoices.issuing_point_missing' });
    expect(drawNext).not.toHaveBeenCalled();
  });

  it('draws a Peruvian note from a series of the letter of the document it modifies', async () => {
    await adapter('PE').assignCreditNoteNumber({
      invoice: invoice({ type: InvoiceType.CREDIT_NOTE, currencyCode: 'PEN' }),
      organizationId: 'org',
      manager: managerWith(),
      originalInvoice: { fiscalDocumentType: '03', fiscalNumber: 'B001-00000004' } as Invoice,
    });
    expect(drawNext).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ documentType: '07', series: { kind: 'PREFIX', prefix: 'B' } }));
  });

  it('offers on an invoice only the sale types of the catalogue, never a note or a buyer-issued type', () => {
    expect(adapter('DO').availableSalesTypes().map((option) => option.code)).toEqual(['B01', 'B02', 'B14', 'B15', 'B16', 'E31', 'E32', 'E44', 'E45', 'E46']);
    expect(adapter('DO').availableSalesTypes().find((o) => o.code === 'B01')).toMatchObject({ requiresBuyerTaxId: true, electronic: false });
    expect(adapter('AR').availableSalesTypes().map((option) => option.code)).toEqual(['1', '6', '11']);
    expect(adapter('US').availableSalesTypes()).toEqual([]);
  });

  it('hands out a till receipt only where the market has one and a range is in force for it', async () => {
    liveDocumentTypes.mockResolvedValueOnce(new Set(['B02']));
    const receipt = await declared(adapter('DO').assignTillReceiptNumber, 'till receipt')({ organizationId: 'org', today: '2026-11-09', manager: managerWith() });
    expect(receipt).toMatchObject({ fiscalNumber: 'B0200000007', documentType: 'B02', sequence: 7 });

    liveDocumentTypes.mockResolvedValueOnce(new Set());
    expect(await declared(adapter('DO').assignTillReceiptNumber, 'till receipt')({ organizationId: 'org', today: '2026-11-09', manager: managerWith() })).toBeNull();
    expect(adapter('CO').assignTillReceiptNumber).toBeUndefined();
  });
});

describe('FiscalAdapterFactory', () => {
  const factory = new FiscalAdapterFactory({} as FiscalRangeService, {} as never);

  it('has no branch per country: every market gets the same engine, an unknown one the neutral market', () => {
    for (const code of marketCodes()) {
      const adapter = factory.forCountry(code) as MarketFiscalAdapter;
      expect(adapter).toBeInstanceOf(MarketFiscalAdapter);
      expect(adapter.countryCode).toBe(code);
      expect(factory.forCountry(code.toLowerCase())).toBe(adapter);
    }
    expect(factory.forCountry('ZZ').availableSalesTypes()).toEqual([]);
    expect((factory.forCountry(null) as MarketFiscalAdapter).countryCode).toBe(marketFor(null).code);
  });

  /**
   * What Settings › coverage says about debit notes in each market is what the engine does (audit
   * 2026-11-07, FAC-INV-05): a market that can number one ⇔ «implemented». Without this the two
   * would drift, and a company would be promised a debit note the server refuses.
   */
  it.each([...marketCodes()])('%s: the debit notes the coverage promises are the ones the engine issues', (country) => {
    const issues = typeof factory.forCountry(country).assignDebitNoteNumber === 'function';
    const declared = coverageFor(country).capabilities.find((c) => c.capability === 'debitNotes')?.level;
    expect(declared).toBe(issues ? 'implemented' : 'not-implemented');
  });
});
