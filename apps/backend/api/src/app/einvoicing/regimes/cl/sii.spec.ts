import { SiiBuilder, SiiBuildInput } from './sii.builder';
import { Invoice, InvoiceType } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';

/**
 * Chile — Documento Tributario Electrónico, SII.
 *
 * Two things are peculiar to Chile and both are asserted here. Amounts are integers, because the
 * peso has no minor unit and the SII rejects a decimal point. And the folio is inseparable from
 * the CAF it was drawn from: the SII verifies the document's timbre against the public key it
 * issued *with that range*, so a folio outside the range is not a numbering slip — it is a
 * document that cannot be validated.
 */
describe('SII — Documento Tributario Electrónico', () => {
  const builder = new SiiBuilder();

  const organization = {
    id: 'org-1',
    legalName: 'COMERCIAL SANTIAGO SPA',
    taxId: '76123456-7',
    industry: 'Venta al por menor',
  } as unknown as Organization;

  const customer = {
    id: 'cus-1',
    companyName: 'CLIENTE VALPARAISO LTDA',
    taxId: '77987654-3',
    address: 'Av. Brasil 1234',
    city: 'Valparaíso',
  } as unknown as Customer;

  const invoice = {
    id: 'inv-1',
    invoiceNumber: '123',
    customerId: 'cus-1',
    issueDate: '2026-06-10',
    currencyCode: 'CLP',
    subtotal: 1_000_000,
    taxedTotal: 1_000_000,
    exemptTotal: 0,
    tax: 190_000,
    total: 1_190_000,
    type: InvoiceType.INVOICE,
    // What the market's numbering recorded at issuance (markets/<cc>/documents.ts).
    fiscalDocumentType: '33',
    fiscalSequence: 150,
    fiscalSeries: '',
    lineItems: [
      {
        description: 'Notebook empresarial',
        quantity: 1,
        price: 1_000_000,
        lineSubtotal: 1_000_000,
        taxRate: 0.19,
        taxAmount: 190_000,
        fiscalCodes: { codigoItem: 'NB-01' },
      },
    ],
  } as unknown as Invoice;

  /** The DTE a note refers to: a factura afecta, folio 77, as the SII granted it. */
  const REFERENCE = {
    fiscalNumber: '77',
    documentType: '33',
    issueDate: '2026-06-10',
    documentKey: null,
    authorityHandle: null,
    // The folio the SII granted and the série it belongs to, as the document recorded them.
    sequence: 77,
    series: '0',
    reasonCode: '3',
    reasonText: null,
  };

  const input = (overrides: Partial<SiiBuildInput> = {}): SiiBuildInput => ({
    invoice,
    organization,
    customer,
    caf: {
      folio: 150,
      rangeFrom: 100,
      rangeTo: 200,
      authorizedOn: '2026-01-15',
      privateKeyPem: '-----BEGIN RSA PRIVATE KEY-----\nMII\n-----END RSA PRIVATE KEY-----',
      rawCafXml: '<CAF version="1.0"><DA><RE>76123456-7</RE></DA></CAF>',
    },
    activityCode: '471000',
    origin: { comuna: 'Santiago', city: 'Santiago', address: 'Av. Providencia 1234' },
    ...overrides,
  });

  it('writes amounts as integers, because the peso has no minor unit', () => {
    const { xml } = builder.build(input());

    // The SII rejects a decimal point in an amount outright.
    expect(xml).toContain('<MntNeto>1000000</MntNeto>');
    expect(xml).toContain('<IVA>190000</IVA>');
    expect(xml).toContain('<MntTotal>1190000</MntTotal>');
    expect(xml).not.toMatch(/<MntTotal>[\d]+\.[\d]+<\/MntTotal>/);
  });

  it('refuses a folio outside the range its CAF authorises', () => {
    // The SII verifies the timbre against the key it issued with that range. A folio from another
    // range is not a numbering slip; it is a document that cannot be validated.
    expect(() => builder.build(input({ caf: { ...input().caf, folio: 250 } }))).toThrow(
      expect.objectContaining({ messageKey: 'einvoicing.cl.folio_folio_outside_authorised_range_from' }),
    );
    expect(() => builder.build(input({ caf: { ...input().caf, folio: 50 } }))).toThrow(
      expect.objectContaining({ messageKey: 'einvoicing.cl.folio_folio_outside_authorised_range_from' }),
    );
  });

  it('gives the document an id the signature can reference', () => {
    const { xml } = builder.build(input());

    // The signature references `Documento`, not the envelope.
    expect(xml).toContain('<Documento ID="DTE-33-150">');
  });

  it('writes the type the document was numbered as: afecta, exenta, nota de crédito', () => {
    // `33` factura afecta, `34` exenta, `61` nota de crédito — decided by the market's numbering from
    // whether the sale bears tax (`markets/cl/documents.ts`), and written here as recorded.
    expect(builder.build(input()).xml).toContain('<TipoDTE>33</TipoDTE>');

    const exempt = builder.build(
      input({
        invoice: {
          ...invoice,
          fiscalDocumentType: '34',
          tax: 0,
          lineItems: [{ ...invoice.lineItems[0], taxAmount: 0, taxRate: 0 }],
        } as unknown as Invoice,
      }),
    );
    expect(exempt.xml).toContain('<TipoDTE>34</TipoDTE>');

    const creditNote = builder.build(
      input({
        invoice: { ...invoice, type: InvoiceType.CREDIT_NOTE, fiscalDocumentType: '61' } as Invoice,
        modifies: REFERENCE,
      }),
    );
    expect(creditNote.xml).toContain('<TipoDTE>61</TipoDTE>');

    const debitNote = builder.build(
      input({
        invoice: { ...invoice, type: InvoiceType.DEBIT_NOTE, fiscalDocumentType: '56' } as Invoice,
        modifies: { ...REFERENCE, reasonCode: '3' },
      }),
    );
    expect(debitNote.xml).toContain('<TipoDTE>56</TipoDTE>');
  });

  /**
   * A note refers to the DTE it corrects, and says what it does to it.
   *
   * The builder wrote no `Referencia` at all (audit FAC-INV-05 / MP-10): the SII rejects a nota de
   * crédito that refers to nothing, and one it accepted would credit a document nobody named.
   */
  it('refers to the document it corrects, by folio, with what it does to it', () => {
    const { xml } = builder.build(
      input({
        invoice: {
          ...invoice,
          type: InvoiceType.CREDIT_NOTE,
          fiscalDocumentType: '61',
          adjustmentReason: 'ANNULMENT',
          notes: 'Operación anulada por acuerdo',
        } as Invoice,
        modifies: { ...REFERENCE, reasonCode: '1', reasonText: 'Operación anulada por acuerdo' },
      }),
    );

    expect(xml).toContain('<Referencia>');
    expect(xml).toContain('<TpoDocRef>33</TpoDocRef>');
    // By folio: the consecutive the SII granted, not a formatted number.
    expect(xml).toContain('<FolioRef>77</FolioRef>');
    expect(xml).toContain('<FchRef>2026-06-10</FchRef>');
    expect(xml).toContain('<CodRef>1</CodRef>');
    expect(xml).toContain('<RazonRef>Operación anulada por acuerdo</RazonRef>');
    // And before the timbre, where the schema puts it.
    expect(xml.indexOf('<Referencia>')).toBeLessThan(xml.indexOf('<TED'));
  });

  it('refuses a note whose reason its market publishes no CodRef for', () => {
    expect(() =>
      builder.build(
        input({
          invoice: { ...invoice, type: InvoiceType.CREDIT_NOTE, fiscalDocumentType: '61' } as Invoice,
          modifies: { ...REFERENCE, reasonCode: null },
        }),
      ),
    ).toThrow(/adjustment_reason_has_no_authority_code/);
  });

  it('writes both RUTs with their check character and no thousands dots', () => {
    const { xml } = builder.build(input());

    expect(xml).toContain('<RUTEmisor>76123456-7</RUTEmisor>');
    expect(xml).toContain('<RUTRecep>77987654-3</RUTRecep>');
  });

  it('builds a timbre carrying the fields a person can verify by eye', () => {
    // The TED exists so a printed document can be checked offline from its barcode, which is why
    // it carries the few fields a reader would compare: who, what number, when, to whom, how much.
    const { ted } = builder.build(input());

    expect(ted).toContain('<RE>76123456-7</RE>');
    expect(ted).toContain('<TD>33</TD>');
    expect(ted).toContain('<F>150</F>');
    expect(ted).toContain('<FE>2026-06-10</FE>');
    expect(ted).toContain('<RR>77987654-3</RR>');
    expect(ted).toContain('<MNT>1190000</MNT>');
    expect(ted).toContain('<IT1>Notebook empresarial</IT1>');
  });

  it('leaves the FRMT the CAF’s own key seals', () => {
    // A Chilean document is signed twice with two keys: the taxpayer's certificate signs the DTE,
    // and the CAF's key signs the timbre inside it.
    const { xml } = builder.build(input());

    // Empty until sealed, so it serialises self-closing; the adapter fills it with the CAF seal.
    expect(xml).toMatch(/<FRMT algoritmo="SHA1withRSA"\s*\/?>/);
  });

  it('carries the issuer’s economic activity, which the SII requires', () => {
    const { xml } = builder.build(input());

    expect(xml).toContain('<Acteco>471000</Acteco>');
    expect(xml).toContain('<CmnaOrigen>Santiago</CmnaOrigen>');
  });

  it.each([
    ['sin CAF', { caf: { ...{ folio: 150, rangeFrom: 100, rangeTo: 200, authorizedOn: '2026-01-15', rawCafXml: '' }, privateKeyPem: '' } as SiiBuildInput['caf'] }, 'einvoicing.cl.sii_caf_missing_without_key_document'],
    ['sin actividad económica', { activityCode: '' }, 'einvoicing.cl.economic_activity_code_sii_requires_document'],
    ['el receptor sin RUT', { customer: { ...customer, taxId: null } as unknown as Customer }, 'einvoicing.cl.customer_customer_has_no_rut'],
  ])('refuses to build %s', (_name, overrides, messageKey) => {
    expect(() => builder.build(input(overrides as Partial<SiiBuildInput>))).toThrow(
      expect.objectContaining({ messageKey }),
    );
  });
});
