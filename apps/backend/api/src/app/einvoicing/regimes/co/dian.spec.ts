import * as crypto from 'crypto';
import { DianBuilder, DianBuildInput } from './dian.builder';
import { Invoice, InvoiceType } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';

/**
 * Colombia — factura electrónica DIAN, UBL 2.1.
 *
 * The CUFE is what these are mostly about. It is a SHA-384 over a fixed concatenation of the
 * invoice's own fields and the taxpayer's technical key, which the DIAN recomputes and compares:
 * an invoice whose CUFE does not reproduce is rejected however correct everything else is. So the
 * tests recompute it independently rather than asserting that some hash is present.
 */
describe('DIAN — factura electrónica', () => {
  const builder = new DianBuilder();

  const organization = {
    id: 'org-1',
    legalName: 'COMERCIALIZADORA ANDINA SAS',
    taxId: '900123456-7',
  } as unknown as Organization;

  const customer = {
    id: 'cus-1',
    companyName: 'DISTRIBUIDORA DEL CARIBE SAS',
    taxId: '901654321-3',
  } as unknown as Customer;

  const invoice = {
    id: 'inv-1',
    invoiceNumber: 'FAC-9',
    // The AUTHORISED number, which is what the authority reads. `invoiceNumber` is this product's
    // own document sequence and carries no fiscal force: the builders used to read it, so a
    // document would have gone out numbered from the internal counter rather than from the range
    // the authority granted.
    ncfNumber: 'SETP990000001',
    customerId: 'cus-1',
    issueDate: '2026-06-10T09:30:00',
    currencyCode: 'COP',
    subtotal: 1_000_000,
    taxedTotal: 1_000_000,
    tax: 190_000,
    excise: 0,
    total: 1_190_000,
    type: InvoiceType.INVOICE,
    lineItems: [
      {
        description: 'Servicio de mantenimiento',
        quantity: 1,
        price: 1_000_000,
        lineSubtotal: 1_000_000,
        taxRate: 0.19,
        taxAmount: 190_000,
        fiscalCodes: { unspsc: '81111800', unitCode: 'EA' },
      },
    ],
  } as unknown as Invoice;

  const input = (overrides: Partial<DianBuildInput> = {}): DianBuildInput => ({
    invoice,
    organization,
    customer,
    technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
    environment: '2',
    resolution: {
      number: '18760000001',
      prefix: 'SETP',
      from: '990000000',
      to: '995000000',
      validUntil: '2027-06-10',
    },
    ...overrides,
  });

  describe('the CUFE', () => {
    it('reproduces the SHA-384 the DIAN recomputes', () => {
      const { cufe } = builder.build(input());

      // Recomputed here from the annex's own field order, independently of the builder: number,
      // date, time, subtotal, three tax slots with their values, total, both identifiers, the
      // technical key and the environment.
      const expected = crypto
        .createHash('sha384')
        .update(
          [
            'SETP990000001',
            '2026-06-10',
            '09:30:00-05:00',
            '1000000.00',
            '01',
            '190000.00',
            '04',
            '0.00',
            '03',
            '0.00',
            '1190000.00',
            '9001234567',
            '9016543213',
            'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
            '2',
          ].join(''),
          'utf8',
        )
        .digest('hex');

      expect(cufe).toBe(expected);
      expect(cufe).toHaveLength(96);
    });

    it('writes a tax the invoice does not bear as zero rather than omitting it', () => {
      // Omitting a slot shifts every following field and produces a different hash. The DIAN then
      // rejects the document with a message about the CUFE and nothing else, which is a hard
      // failure to diagnose from the outside.
      const { cufe: withExcise } = builder.build(
        input({ invoice: { ...invoice, excise: 50_000 } as Invoice }),
      );
      const { cufe: withoutExcise } = builder.build(input());

      expect(withExcise).not.toBe(withoutExcise);
    });

    it('differs between the test and production environments', () => {
      // Deliberate: a document approved in testing must not be presentable as a production one.
      const test = builder.build(input({ environment: '2' })).cufe;
      const production = builder.build(input({ environment: '1' })).cufe;

      expect(test).not.toBe(production);
    });

    it('changes when any figure on the invoice changes', () => {
      const original = builder.build(input()).cufe;
      const altered = builder.build(
        input({ invoice: { ...invoice, total: 1_190_001 } as Invoice }),
      ).cufe;

      expect(altered).not.toBe(original);
    });
  });

  describe('the UBL document', () => {
    it('declares the DIAN profile and carries the CUFE', () => {
      const { xml, cufe } = builder.build(input());

      expect(xml).toContain('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>');
      expect(xml).toContain('<cbc:ProfileID>DIAN 2.1</cbc:ProfileID>');
      expect(xml).toContain('<cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>');
      expect(xml).toContain(`<cbc:UUID schemeName="CUFE-SHA384">${cufe}</cbc:UUID>`);
      expect(xml).toContain('<cbc:ID>SETP990000001</cbc:ID>');
    });

    it('carries the authorising resolution and its range', () => {
      // A Colombian invoice number is not free: the DIAN authorises a prefix and a numeric range
      // by resolution, and the document has to name the one it was drawn from.
      const { xml } = builder.build(input());

      expect(xml).toContain('<sts:InvoiceAuthorization>18760000001</sts:InvoiceAuthorization>');
      expect(xml).toContain('<sts:Prefix>SETP</sts:Prefix>');
      expect(xml).toContain('<sts:From>990000000</sts:From>');
      expect(xml).toContain('<sts:To>995000000</sts:To>');
    });

    it('states both parties with their NIT and its verification digit', () => {
      const { xml } = builder.build(input());

      expect(xml).toContain('COMERCIALIZADORA ANDINA SAS');
      expect(xml).toContain('DISTRIBUIDORA DEL CARIBE SAS');
      // The NIT's digits and its check digit travel in separate places.
      expect(xml).toContain('schemeID="7"');
      expect(xml).toContain('>900123456<');
    });

    it('states the IVA with its base, its rate and its amount', () => {
      const { xml } = builder.build(input());

      expect(xml).toContain('<cbc:TaxableAmount currencyID="COP">1000000.00</cbc:TaxableAmount>');
      expect(xml).toContain('<cbc:TaxAmount currencyID="COP">190000.00</cbc:TaxAmount>');
      expect(xml).toContain('<cbc:Percent>19.00</cbc:Percent>');
      expect(xml).toContain('<cbc:Name>IVA</cbc:Name>');
    });

    it('issues a credit note as document type 91', () => {
      const { xml } = builder.build(
        input({ invoice: { ...invoice, type: InvoiceType.CREDIT_NOTE } as Invoice }),
      );

      expect(xml).toContain('<cbc:InvoiceTypeCode>91</cbc:InvoiceTypeCode>');
    });

    it('carries the UNSPSC code the product declares', () => {
      const { xml } = builder.build(input());

      expect(xml).toContain('81111800');
      expect(xml).toContain('unitCode="EA"');
    });

    it('leaves an extension slot for the signature', () => {
      // XAdES goes inside a `UBLExtension`, and the DIAN's own extension occupies the first one.
      const { xml } = builder.build(input());

      expect(xml).toContain('sts:DianExtensions');
      expect((xml.match(/<ext:UBLExtension>/g) ?? []).length).toBe(2);
    });

    it.each([
      ['el emisor sin NIT', { organization: { ...organization, taxId: null } as unknown as Organization }, 'EINVOICING.DIAN_EMISOR_SIN_NIT'],
      ['el receptor sin documento', { customer: { ...customer, taxId: null } as unknown as Customer }, 'EINVOICING.DIAN_RECEPTOR_SIN_DOCUMENTO'],
      ['sin clave técnica', { technicalKey: '' }, 'EINVOICING.DIAN_SIN_CLAVE_TECNICA'],
    ])('refuses to build with %s', (_name, overrides, messageKey) => {
      expect(() => builder.build(input(overrides as Partial<DianBuildInput>))).toThrow(
        expect.objectContaining({ messageKey }),
      );
    });
  });
});
