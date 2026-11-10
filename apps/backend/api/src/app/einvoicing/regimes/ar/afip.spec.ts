import * as crypto from 'crypto';
import {
  AfipBuilder,
  AfipBuildInput,
  loginTicketRequest,
  signLoginTicket,
} from './afip.builder';
import { Invoice, InvoiceType } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';

/**
 * Argentina — AFIP, WSFEv1.
 *
 * The one regime that receives no document: AFIP takes a structure of fields and answers with a
 * CAE. So what is asserted here is the structure and the two pieces of arithmetic that surround
 * it — the printed barcode's modulus-10 check digit, and the CMS envelope that authenticates the
 * call, which is signed and therefore verifiable.
 */
describe('AFIP — WSFEv1', () => {
  const builder = new AfipBuilder();

  const organization = {
    id: 'org-1',
    legalName: 'DISTRIBUIDORA PORTEÑA SRL',
    taxId: '30-71234567-8',
  } as unknown as Organization;

  const registeredBuyer = {
    id: 'cus-1',
    companyName: 'MAYORISTA CORDOBES SA',
    taxId: '30-70987654-3',
    // The recorded catalogue code — the builder states DocTipo `80` from this, not from the length.
    identityDocumentTypeCode: 'CUIT',
    identityDocumentCountry: 'AR',
  } as unknown as Customer;

  const invoice = {
    id: 'inv-1',
    invoiceNumber: '123',
    customerId: 'cus-1',
    issueDate: '2026-06-10',
    currencyCode: 'ARS',
    exchangeRate: 1,
    subtotal: 100_000,
    taxedTotal: 100_000,
    exemptTotal: 0,
    tax: 21_000,
    excise: 0,
    total: 121_000,
    type: InvoiceType.INVOICE,
    // The class the market's numbering decided at issuance: factura A, between two responsables inscriptos.
    fiscalDocumentType: '1',
    lineItems: [
      { description: 'Mercadería', quantity: 1, price: 100_000, lineSubtotal: 100_000, taxRate: 0.21, taxAmount: 21_000, isService: false },
    ],
  } as unknown as Invoice;

  const input = (overrides: Partial<AfipBuildInput> = {}): AfipBuildInput => ({
    invoice,
    organization,
    customer: registeredBuyer,
    salesPoint: 4,
    nextNumber: 123,
    ...overrides,
  });

  describe('the request', () => {
    it('states the amounts AFIP reconciles against each other', () => {
      const request = builder.build(input());
      const [detail] = request.FeDetReq;

      // ImpTotal = ImpNeto + ImpIVA + ImpOpEx + ImpTotConc + ImpTrib. AFIP rejects the request
      // outright when they do not add up, before any business rule is applied.
      expect(detail.ImpNeto).toBe(100_000);
      expect(detail.ImpIVA).toBe(21_000);
      expect(detail.ImpTotal).toBe(121_000);
      expect(
        detail.ImpNeto + detail.ImpIVA + detail.ImpOpEx + detail.ImpTotConc + detail.ImpTrib,
      ).toBe(detail.ImpTotal);
    });

    it('writes the class the document was numbered as, decided once from both parties at issuance', () => {
      // The rule (A between two responsables inscriptos, B to anybody else, C from an exempt or
      // monotributo issuer) is the market's numbering, `markets/ar/documents.ts`; the builder writes
      // what was decided rather than deciding again.
      const as = (fiscalDocumentType: string, type = InvoiceType.INVOICE) =>
        builder.build(input({ invoice: { ...invoice, type, fiscalDocumentType } as Invoice })).FeCabReq.CbteTipo;
      expect(as('1')).toBe(1);
      expect(as('6')).toBe(6);
      expect(as('11')).toBe(11);
      expect(as('3', InvoiceType.CREDIT_NOTE)).toBe(3);
    });

    it('refuses a type it does not write, and a document that was never typed', () => {
      // A debit note (2, 7, 12) is not built yet: refused by name, never sent as something else.
      expect(() => builder.build(input({ invoice: { ...invoice, fiscalDocumentType: '2' } as Invoice }))).toThrow(
        expect.objectContaining({ messageKey: 'einvoicing.document_type_not_built_by_regime' }),
      );
      expect(() => builder.build(input({ invoice: { ...invoice, fiscalDocumentType: null } as Invoice }))).toThrow(
        expect.objectContaining({ messageKey: 'einvoicing.document_has_no_fiscal_document_type' }),
      );
    });

    it('identifies the buyer by their recorded document type, not the shape', () => {
      // `80` CUIT, `96` DNI, `99` consumidor final sin identificar — read from the catalogue.
      expect(builder.build(input()).FeDetReq[0].DocTipo).toBe(80);

      const withDni = builder.build(
        input({
          customer: {
            ...registeredBuyer,
            taxId: '25123456',
            identityDocumentTypeCode: 'DNI',
          } as unknown as Customer,
        }),
      );
      expect(withDni.FeDetReq[0].DocTipo).toBe(96);

      const anonymous = builder.build(
        input({
          customer: {
            ...registeredBuyer,
            taxId: null,
            identityDocumentTypeCode: null,
          } as unknown as Customer,
        }),
      );
      expect(anonymous.FeDetReq[0].DocTipo).toBe(99);
      expect(anonymous.FeDetReq[0].DocNro).toBe(0);
    });

    it('declares the concept from what was actually sold', () => {
      // `1` productos, `2` servicios, `3` ambos. A services document also needs its service
      // period, which AFIP validates against the issue date.
      expect(builder.build(input()).FeDetReq[0].Concepto).toBe(1);

      const services = builder.build(
        input({
          invoice: {
            ...invoice,
            lineItems: [{ ...invoice.lineItems[0], isService: true }],
          } as unknown as Invoice,
        }),
      );
      expect(services.FeDetReq[0].Concepto).toBe(2);

      const both = builder.build(
        input({
          invoice: {
            ...invoice,
            lineItems: [
              { ...invoice.lineItems[0], isService: true },
              { ...invoice.lineItems[0], isService: false },
            ],
          } as unknown as Invoice,
        }),
      );
      expect(both.FeDetReq[0].Concepto).toBe(3);
    });

    it('states the VAT rate by AFIP’s own identifier', () => {
      // `5` is 21 %, `4` is 10.5 %, `6` is 27 %.
      expect(builder.build(input()).FeDetReq[0].Iva?.[0].Id).toBe(5);

      const reduced = builder.build(
        input({
          invoice: {
            ...invoice,
            lineItems: [{ ...invoice.lineItems[0], taxRate: 0.105 }],
          } as unknown as Invoice,
        }),
      );
      expect(reduced.FeDetReq[0].Iva?.[0].Id).toBe(4);
    });

    it('sends the peso as PES and a foreign currency with its rate', () => {
      expect(builder.build(input()).FeDetReq[0].MonId).toBe('PES');
      expect(builder.build(input()).FeDetReq[0].MonCotiz).toBe(1);

      const inDollars = builder.build(
        input({
          invoice: { ...invoice, currencyCode: 'USD', exchangeRate: 1_050 } as Invoice,
        }),
      );
      expect(inDollars.FeDetReq[0].MonId).toBe('DOL');
      expect(inDollars.FeDetReq[0].MonCotiz).toBe(1_050);
    });

    it.each([
      ['el emisor sin CUIT', { organization: { ...organization, taxId: '123' } as unknown as Organization }, 'einvoicing.ar.organization_has_no_valid_cuit_afip'],
      ['sin punto de venta', { salesPoint: 0 }, 'einvoicing.ar.point_sale_afip_assigned_establishment_missing'],
      ['sin número de comprobante', { nextNumber: 0 }, 'einvoicing.ar.document_number_afip_expects_next_missing'],
    ])('refuses to build %s', (_name, overrides, messageKey) => {
      expect(() => builder.build(input(overrides as Partial<AfipBuildInput>))).toThrow(
        expect.objectContaining({ messageKey }),
      );
    });
  });

  describe('the printed barcode', () => {
    it('closes with a modulus-10 check digit an inspector’s reader verifies', () => {
      const barcode = builder.barcode({
        cuit: '30-71234567-8',
        documentType: 1,
        salesPoint: 4,
        cae: '75123456789012',
        caeExpiry: '2026-06-20',
      });

      expect(barcode).toHaveLength(40);
      expect(barcode.startsWith('30712345678')).toBe(true);

      // Recomputed independently: odd positions summed, even positions summed and tripled.
      const body = barcode.slice(0, -1);
      let odd = 0;
      let even = 0;
      for (let index = 0; index < body.length; index++) {
        if ((index + 1) % 2 === 1) odd += Number(body[index]);
        else even += Number(body[index]);
      }
      expect(barcode.slice(-1)).toBe(String((10 - ((odd * 3 + even) % 10)) % 10));
    });
  });

  describe('the WSAA login ticket', () => {
    it('asks for a window AFIP accepts', () => {
      const now = new Date('2026-06-10T12:00:00Z');
      const ticket = loginTicketRequest('wsfe', now);

      expect(ticket).toContain('<service>wsfe</service>');
      // AFIP checks that generation is not in the future and expiry is under twenty-four hours
      // out. Ten minutes of slack absorbs the clock skew between us and them.
      expect(ticket).toContain('<generationTime>2026-06-10T11:50:00Z</generationTime>');
      expect(ticket).toContain('<expirationTime>2026-06-11T00:00:00Z</expirationTime>');
    });

    it('is signed into a CMS envelope that carries the ticket back out', () => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

      const forge = require('node-forge') as typeof import('node-forge');
      const cert = forge.pki.createCertificate();
      cert.publicKey = forge.pki.publicKeyFromPem(
        publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      );
      cert.serialNumber = '01';
      cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
      cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
      const attrs = [{ name: 'commonName', value: 'AFIP PRUEBAS' }];
      cert.setSubject(attrs);
      cert.setIssuer(attrs);
      cert.sign(forge.pki.privateKeyFromPem(privateKeyPem), forge.md.sha256.create());
      const certificatePem = forge.pki.certificateToPem(cert);

      const ticket = loginTicketRequest('wsfe', new Date('2026-06-10T12:00:00Z'));
      const cms = signLoginTicket(ticket, certificatePem, privateKeyPem);

      // Base64 DER, which is what the SOAP call carries. Parsed back to prove it is a real
      // PKCS#7 signed-data holding the ticket we signed — not an opaque string.
      expect(cms).toMatch(/^[A-Za-z0-9+/]+=*$/);
      const parsed = forge.pkcs7.messageFromAsn1(
        forge.asn1.fromDer(forge.util.decode64(cms)),
      ) as unknown as { rawCapture?: { content: { value: { value: string }[] } } };
      expect(parsed.rawCapture).toBeDefined();
      const content = forge.util.decodeUtf8(parsed.rawCapture!.content.value[0].value);
      expect(content).toContain('<service>wsfe</service>');
    });
  });
});
