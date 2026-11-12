import { SriBuilder, SriBuildInput } from './sri.builder';
import { Invoice, InvoiceType } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';

/**
 * Ecuador — comprobante electrónico, SRI.
 *
 * The clave de acceso is the thing to get right: forty-nine digits computed by the issuer, which
 * the SRI recomputes on receipt. Its check digit is a modulus 11 with weights cycling 2..7, and
 * the two remainders that need special handling — 0 and 1 — are rare enough to pass a casual test
 * and to fail in production, so they are tested explicitly.
 */
describe('SRI — comprobante electrónico', () => {
  const builder = new SriBuilder();

  const organization = {
    id: 'org-1',
    legalName: 'COMERCIAL QUITO CIA LTDA',
    taxId: '1790012345001',
    address: 'Av. Amazonas N30-100',
  } as unknown as Organization;

  const customer = {
    id: 'cus-1',
    companyName: 'CLIENTE GUAYAQUIL SA',
    taxId: '0992123456001',
    // The document the customer was recorded with — the builder states the type from this, not from
    // the number's length.
    identityDocumentTypeCode: 'RUC',
  } as unknown as Customer;

  const invoice = {
    id: 'inv-1',
    invoiceNumber: 'FAC-9',
    // The AUTHORISED number, which is what the authority reads. `invoiceNumber` is this product's
    // own document sequence and carries no fiscal force: the builders used to read it, so a
    // document would have gone out numbered from the internal counter rather than from the range
    // the authority granted.
    fiscalNumber: '001-001-000000123',
    customerId: 'cus-1',
    issueDate: '2026-06-10',
    currencyCode: 'USD',
    subtotal: 1_000,
    taxedTotal: 1_000,
    tax: 150,
    total: 1_150,
    discountTotal: 0,
    serviceCharge: 0,
    type: InvoiceType.INVOICE,
    // What the market's numbering recorded at issuance (markets/<cc>/documents.ts).
    fiscalDocumentType: '01',
    fiscalSequence: 123,
    fiscalSeries: '001-001',
    lineItems: [
      {
        description: 'Servicio profesional',
        quantity: 1,
        price: 1_000,
        lineSubtotal: 1_000,
        taxableBase: 1_000,
        taxRate: 0.15,
        taxAmount: 150,
        discountAmount: 0,
        fiscalCodes: { codigoPrincipal: 'SRV-01' },
      },
    ],
  } as unknown as Invoice;

  /** The factura a note corrects, as `modifiedDocumentOf` resolves it. */
  const REFERENCE = {
    fiscalNumber: '001-001-000000077',
    documentType: '01',
    issueDate: '2026-06-01',
    documentKey: null,
    authorityHandle: null,
    sequence: 77,
    series: '001-001',
    // Null, and not for want of transcribing: the SRI publishes no catalogue of correction
    // concepts, so the note says why in words.
    reasonCode: null,
    reasonText: 'Devolución parcial de mercadería',
  };

  const input = (overrides: Partial<SriBuildInput> = {}): SriBuildInput => ({
    invoice,
    organization,
    customer,
    environment: '1',
    establishment: '001',
    emissionPoint: '001',
    numericCode: '12345678',
    ...overrides,
  });

  describe('the clave de acceso', () => {
    it('is forty-nine digits in the order the ficha técnica fixes', () => {
      const key = builder.accessKey(input());

      expect(key).toHaveLength(49);
      // ddmmaaaa, tipo, ruc, ambiente, serie, secuencial, código, tipoEmisión, verificador.
      expect(key.slice(0, 8)).toBe('10062026');
      expect(key.slice(8, 10)).toBe('01');
      expect(key.slice(10, 23)).toBe('1790012345001');
      expect(key.slice(23, 24)).toBe('1');
      expect(key.slice(24, 30)).toBe('001001');
      expect(key.slice(30, 39)).toBe('000000123');
      expect(key.slice(39, 47)).toBe('12345678');
      expect(key.slice(47, 48)).toBe('1');
    });

    it('closes with a modulus-11 check digit over the other forty-eight', () => {
      const key = builder.accessKey(input());
      const body = key.slice(0, 48);

      expect(key.slice(48)).toBe(builder.modulus11(body));

      // Recomputed here independently: weights 2..7 cycling from the right.
      let total = 0;
      let weight = 2;
      for (let index = body.length - 1; index >= 0; index--) {
        total += Number(body[index]) * weight;
        weight = weight === 7 ? 2 : weight + 1;
      }
      const remainder = total % 11;
      const expected = remainder === 0 ? '0' : remainder === 1 ? '1' : String(11 - remainder);
      expect(key.slice(48)).toBe(expected);
    });

    it('answers 0 and 1 for the two remainders that are not 11 minus the remainder', () => {
      // `11 - remainder` unconditionally yields 11 and 10 here, which are not digits. The bug
      // survives any test that does not happen to land on these two remainders.
      const zeroRemainder = builder.modulus11('0');
      expect(zeroRemainder).toBe('0');

      // Constructed to leave a remainder of 1: a single digit weighted by 2 gives 2·d mod 11 = 1
      // when d = 6.
      expect(builder.modulus11('6')).toBe('1');
    });

    it('changes with the environment, so a test document cannot pass as a production one', () => {
      expect(builder.accessKey(input({ environment: '1' }))).not.toBe(
        builder.accessKey(input({ environment: '2' })),
      );
    });
  });

  describe('the document', () => {
    it('carries the key, the establishment and the emission point', () => {
      const { xml, accessKey } = builder.build(input());

      expect(xml).toContain(`<claveAcceso>${accessKey}</claveAcceso>`);
      expect(xml).toContain('<estab>001</estab>');
      expect(xml).toContain('<ptoEmi>001</ptoEmi>');
      expect(xml).toContain('<secuencial>000000123</secuencial>');
      expect(xml).toContain('version="2.1.0"');
    });

    it('writes the date the way the SRI reads it', () => {
      const { xml } = builder.build(input());

      // `dd/mm/aaaa` in the body, `ddmmaaaa` in the key. Two formats for one date, both required.
      expect(xml).toContain('<fechaEmision>10/06/2026</fechaEmision>');
    });

    it('states the IVA with the rate’s own catalogue code', () => {
      const { xml } = builder.build(input());

      // 15 % is código 4. The rate is not written as a percentage anywhere the SRI reads it as one.
      expect(xml).toContain('<codigoPorcentaje>4</codigoPorcentaje>');
      expect(xml).toContain('<tarifa>15.00</tarifa>');
      expect(xml).toContain('<baseImponible>1000.00</baseImponible>');
      expect(xml).toContain('<valor>150.00</valor>');
    });

    it('states the buyer document type from the catalogue, not the length of the number', () => {
      // `04` RUC, `05` cédula, `06` pasaporte — the recorded document type, so a mistyped number is
      // not silently re-typed as another kind (A-02).
      expect(builder.build(input()).xml).toContain(
        '<tipoIdentificacionComprador>04</tipoIdentificacionComprador>',
      );

      const withCedula = builder.build(
        input({
          customer: {
            ...customer,
            identityDocumentTypeCode: 'CEDULA',
            taxId: '0912345678',
          } as unknown as Customer,
        }),
      );
      expect(withCedula.xml).toContain(
        '<tipoIdentificacionComprador>05</tipoIdentificacionComprador>',
      );

      // A passport is `06`, kept alphanumeric — length inference declared this buyer a consumidor
      // final because the number is neither ten nor thirteen digits.
      const withPassport = builder.build(
        input({
          customer: {
            ...customer,
            identityDocumentTypeCode: 'PASSPORT',
            identityDocumentCountry: 'XX',
            taxId: 'A1234567',
          } as unknown as Customer,
        }),
      );
      expect(withPassport.xml).toContain(
        '<tipoIdentificacionComprador>06</tipoIdentificacionComprador>',
      );
      expect(withPassport.xml).toContain('<identificacionComprador>A1234567</identificacionComprador>');
    });

    it('falls to consumidor final only when no document is recorded, not by length', () => {
      // The one case decided by ABSENCE: a walk-in with no document type and no number is `07`.
      const walkIn = builder.build(
        input({
          customer: {
            ...customer,
            identityDocumentTypeCode: null,
            taxId: '',
          } as unknown as Customer,
        }),
      );
      expect(walkIn.xml).toContain(
        '<tipoIdentificacionComprador>07</tipoIdentificacionComprador>',
      );
    });

    it('issues a credit note as document type 04', () => {
      const { accessKey } = builder.build(
        input({
          invoice: { ...invoice, type: InvoiceType.CREDIT_NOTE, fiscalDocumentType: '04' } as Invoice,
          modifies: REFERENCE,
        }),
      );

      expect(accessKey.slice(8, 10)).toBe('04');
    });
  });

  /**
   * A nota de crédito and a nota de débito are comprobantes of their own.
   *
   * Both were built as a `factura` (audit FAC-INV-05 / MP-10): the root, the info block, the
   * version and the fields all belonged to an invoice, so the SRI had no `codDocModificado` to tie
   * the correction to — and a credit the authority cannot tie to its invoice is a credit the
   * taxpayer cannot prove.
   */
  describe('a note', () => {
    const creditNote = (overrides: Partial<Invoice> = {}) =>
      builder.build(
        input({
          invoice: {
            ...invoice,
            type: InvoiceType.CREDIT_NOTE,
            fiscalDocumentType: '04',
            ...overrides,
          } as Invoice,
          modifies: REFERENCE,
        }),
      ).xml;

    const debitNote = (modifies = REFERENCE) =>
      builder.build(
        input({
          invoice: {
            ...invoice,
            type: InvoiceType.DEBIT_NOTE,
            fiscalDocumentType: '05',
          } as Invoice,
          modifies,
        }),
      ).xml;

    it('is its own comprobante, under its own root and its own version', () => {
      const credit = creditNote();
      expect(credit).toContain('<notaCredito');
      expect(credit).toContain('<infoNotaCredito>');
      expect(credit).not.toContain('<infoFactura>');
      expect(credit).toContain('version="1.1.0"');

      const debit = debitNote();
      expect(debit).toContain('<notaDebito');
      expect(debit).toContain('<infoNotaDebito>');
      expect(debit).toContain('version="1.0.0"');

      // And the factura is untouched by any of it.
      expect(builder.build(input()).xml).toContain('<factura');
      expect(builder.build(input()).xml).toContain('version="2.1.0"');
    });

    it('names the comprobante it modifies, with its type, number and date', () => {
      const xml = creditNote();

      expect(xml).toContain('<codDocModificado>01</codDocModificado>');
      expect(xml).toContain('<numDocModificado>001-001-000000077</numDocModificado>');
      // The date of the document being corrected, not of the note.
      expect(xml).toContain('<fechaEmisionDocSustento>01/06/2026</fechaEmisionDocSustento>');
      expect(xml).toContain('<valorModificacion>1150.00</valorModificacion>');
    });

    it('says why in words, because the SRI publishes no code for it', () => {
      expect(creditNote()).toContain('<motivo>Devolución parcial de mercadería</motivo>');

      const debit = debitNote();
      expect(debit).toContain('<motivos>');
      expect(debit).toContain('<razon>Devolución parcial de mercadería</razon>');
      expect(debit).toContain('<valor>1150.00</valor>');
    });

    it('invents no motivo when the issuer wrote none', () => {
      // The field is optional in the ficha técnica. A sentence nobody wrote is worse than none:
      // the note would state a reason the taxpayer never gave.
      const xml = builder.build(
        input({
          invoice: { ...invoice, type: InvoiceType.CREDIT_NOTE, fiscalDocumentType: '04' } as Invoice,
          modifies: { ...REFERENCE, reasonText: null },
        }),
      ).xml;

      expect(xml).not.toContain('<motivo>');
      // The reference, which IS mandatory, is there all the same.
      expect(xml).toContain('<numDocModificado>001-001-000000077</numDocModificado>');
    });

    it('refuses to build a note that names no document', () => {
      expect(() =>
        builder.build(
          input({
            invoice: { ...invoice, type: InvoiceType.CREDIT_NOTE, fiscalDocumentType: '04' } as Invoice,
            modifies: null,
          }),
        ),
      ).toThrow(/note_must_name_the_document_it_modifies/);
    });

    it('states the fields each note has and not the invoice’s', () => {
      // A nota de crédito keeps its detalles and totals its tax; a nota de débito has neither,
      // and states its own `impuestos` with the rate and a `valorTotal`.
      const credit = creditNote();
      expect(credit).toContain('<detalles>');
      expect(credit).toContain('<totalConImpuestos>');
      expect(credit).not.toContain('<importeTotal>');
      expect(credit).not.toContain('<propina>');
      // The item code the nota de crédito's own version names.
      expect(credit).toContain('<codigoInterno>SRV-01</codigoInterno>');

      const debit = debitNote();
      expect(debit).not.toContain('<detalles>');
      expect(debit).toContain('<valorTotal>1150.00</valorTotal>');
      expect(debit).toContain('<tarifa>15.00</tarifa>');
    });

    it('is signed inside its own root, which is not factura', () => {
      // The signature is appended by element name. Appending it to `factura` on a note leaves the
      // comprobante unsigned, and the SRI refuses an unsigned comprobante.
      expect(
        builder.rootElement({ ...invoice, fiscalDocumentType: '04' } as Invoice),
      ).toBe('notaCredito');
      expect(builder.rootElement({ ...invoice, fiscalDocumentType: '05' } as Invoice)).toBe('notaDebito');
      expect(builder.rootElement(invoice)).toBe('factura');
    });
  });

  describe('refusals', () => {
    it.each([
      ['el emisor sin RUC', { organization: { ...organization, taxId: null } as unknown as Organization }, 'einvoicing.ec.organization_has_no_ruc_sri_does'],
      ['sin establecimiento', { establishment: '' }, 'einvoicing.ec.sri_establishment_point_issue_missing'],
    ])('refuses to build with %s', (_name, overrides, messageKey) => {
      expect(() => builder.build(input(overrides as Partial<SriBuildInput>))).toThrow(
        expect.objectContaining({ messageKey }),
      );
    });
  });
});
