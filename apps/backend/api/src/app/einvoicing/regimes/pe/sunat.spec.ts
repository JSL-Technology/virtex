import { SunatBuilder, SunatBuildInput } from './sunat.builder';
import { Invoice, InvoiceType } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';

/**
 * Peru — comprobante de pago electrónico, SUNAT.
 *
 * The document's own name is what SUNAT checks first: `RUC-Tipo-Serie-Correlativo` is the file
 * name, the name inside the ZIP, and the identifier in every later exchange. It is rejected before
 * the document is read if it disagrees with the content, which is why the type is derived from the
 * series rather than chosen beside it.
 */
describe('SUNAT — comprobante de pago electrónico', () => {
  const builder = new SunatBuilder();

  const organization = {
    id: 'org-1',
    legalName: 'SERVICIOS ANDINOS SAC',
    taxId: '20123456789',
  } as unknown as Organization;

  const customer = {
    id: 'cus-1',
    companyName: 'CLIENTE PERUANO SAC',
    taxId: '20987654321',
  } as unknown as Customer;

  const invoice = {
    id: 'inv-1',
    invoiceNumber: '123',
    customerId: 'cus-1',
    issueDate: '2026-06-10',
    dueDate: '2026-07-10',
    currencyCode: 'PEN',
    subtotal: 1_000,
    taxedTotal: 1_000,
    tax: 180,
    total: 1_180,
    discountTotal: 0,
    type: InvoiceType.INVOICE,
    lineItems: [
      {
        description: 'Consultoría',
        quantity: 1,
        price: 1_000,
        lineSubtotal: 1_000,
        taxableBase: 1_000,
        taxRate: 0.18,
        taxAmount: 180,
        discountAmount: 0,
        fiscalCodes: { unitCode: 'ZZ', codigoProducto: 'SRV-01' },
      },
    ],
  } as unknown as Invoice;

  const input = (overrides: Partial<SunatBuildInput> = {}): SunatBuildInput => ({
    invoice,
    organization,
    customer,
    series: 'F001',
    ...overrides,
  });

  it('names the document the way every later exchange refers to it', () => {
    const { documentName } = builder.build(input());

    // RUC — tipo — serie — correlativo, zero-padded to eight.
    expect(documentName).toBe('20123456789-01-F001-00000123');
  });

  it('derives the document type from the series rather than beside it', () => {
    // An `F` series is a factura and a `B` series a boleta. SUNAT rejects the submission before
    // reading the document when the two disagree.
    expect(builder.build(input({ series: 'F001' })).documentName).toContain('-01-');
    expect(builder.build(input({ series: 'B001' })).documentName).toContain('-03-');
    expect(
      builder.build(input({ invoice: { ...invoice, type: InvoiceType.CREDIT_NOTE } as Invoice }))
        .documentName,
    ).toContain('-07-');
  });

  it('builds a UBL 2.1 invoice with the SUNAT customisation', () => {
    const { xml } = builder.build(input());

    expect(xml).toContain('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>');
    expect(xml).toContain('<cbc:CustomizationID>2.0</cbc:CustomizationID>');
    expect(xml).toContain('<cbc:ID>F001-00000123</cbc:ID>');
    expect(xml).toContain('<cbc:InvoiceTypeCode listID="0101">01</cbc:InvoiceTypeCode>');
  });

  it('states the IGV with its catalogue codes', () => {
    const { xml } = builder.build(input());

    // Catálogo 05: `1000` IGV, type `VAT`.
    expect(xml).toContain('<cbc:ID>1000</cbc:ID>');
    expect(xml).toContain('<cbc:Name>IGV</cbc:Name>');
    expect(xml).toContain('<cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>');
    expect(xml).toContain('<cbc:Percent>18.00</cbc:Percent>');
    // Catálogo 07: `10` gravado, operación onerosa.
    expect(xml).toContain('<cbc:TaxExemptionReasonCode>10</cbc:TaxExemptionReasonCode>');
  });

  it('states the price with tax included as the pricing reference', () => {
    const { xml } = builder.build(input());

    // SUNAT wants both: the net unit price and the value of the operation per unit.
    expect(xml).toContain('<cbc:PriceTypeCode>01</cbc:PriceTypeCode>');
    expect(xml).toContain('1180.00');
  });

  it('identifies the buyer by the length of their document', () => {
    // Catálogo 06: `6` RUC (11 digits), `1` DNI (8), `0` when none was stated.
    expect(builder.build(input()).xml).toContain('schemeID="6"');

    const withDni = builder.build(
      input({ customer: { ...customer, taxId: '45678912' } as unknown as Customer }),
    );
    expect(withDni.xml).toContain('schemeID="1"');
  });

  it('issues a credit note with the credit-note element names', () => {
    const { xml } = builder.build(
      input({ invoice: { ...invoice, type: InvoiceType.CREDIT_NOTE } as Invoice }),
    );

    expect(xml).toContain('<CreditNote');
    expect(xml).toContain('cac:CreditNoteLine');
    expect(xml).toContain('cbc:CreditedQuantity');
  });

  it('leaves the extension the signature goes into', () => {
    const { xml } = builder.build(input());

    expect(xml).toContain('ext:UBLExtensions');
    expect(xml).toContain('ext:ExtensionContent');
  });

  it.each([
    ['el emisor sin RUC', { organization: { ...organization, taxId: null } as unknown as Organization }, 'EINVOICING.SUNAT_EMISOR_SIN_RUC'],
    ['sin serie', { series: '' }, 'EINVOICING.SUNAT_SIN_SERIE'],
  ])('refuses to build with %s', (_name, overrides, messageKey) => {
    expect(() => builder.build(input(overrides as Partial<SunatBuildInput>))).toThrow(
      expect.objectContaining({ messageKey }),
    );
  });
});
