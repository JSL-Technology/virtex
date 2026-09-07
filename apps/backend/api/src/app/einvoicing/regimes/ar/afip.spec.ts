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
    fiscalProfile: { condicionIva: 'RESPONSABLE_INSCRIPTO' },
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
    lineItems: [
      { description: 'Mercadería', quantity: 1, price: 100_000, lineSubtotal: 100_000, taxRate: 0.21, taxAmount: 21_000, isService: false },
    ],
  } as unknown as Invoice;

  const input = (overrides: Partial<AfipBuildInput> = {}): AfipBuildInput => ({
    invoice,
    organization,
    customer: registeredBuyer,
    salesPoint: 4,
    issuerVatCondition: 'RESPONSABLE_INSCRIPTO',
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

    it('chooses the document type from both parties’ VAT condition', () => {
      // An A invoice lets the buyer take the VAT credit; issuing one to somebody not entitled to
      // it is a fiscal problem for both parties, not a formatting slip.
      expect(builder.build(input()).FeCabReq.CbteTipo).toBe(1);

      const toConsumer = builder.build(
        input({
          customer: { ...registeredBuyer, fiscalProfile: {} } as unknown as Customer,
        }),
      );
      expect(toConsumer.FeCabReq.CbteTipo).toBe(6);

      const fromMonotributista = builder.build(input({ issuerVatCondition: 'MONOTRIBUTO' }));
      expect(fromMonotributista.FeCabReq.CbteTipo).toBe(11);
    });

    it('numbers a credit note in its own series', () => {
      const creditNote = builder.build(
        input({ invoice: { ...invoice, type: InvoiceType.CREDIT_NOTE } as Invoice }),
      );

      expect(creditNote.FeCabReq.CbteTipo).toBe(3);
    });

    it('identifies the buyer by the shape of their document', () => {
      // `80` CUIT, `96` DNI, `99` consumidor final sin identificar.
      expect(builder.build(input()).FeDetReq[0].DocTipo).toBe(80);

      const withDni = builder.build(
        input({ customer: { ...registeredBuyer, taxId: '25123456' } as unknown as Customer }),
      );
      expect(withDni.FeDetReq[0].DocTipo).toBe(96);

      const anonymous = builder.build(
        input({ customer: { ...registeredBuyer, taxId: null } as unknown as Customer }),
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
      ['el emisor sin CUIT', { organization: { ...organization, taxId: '123' } as unknown as Organization }, 'EINVOICING.AFIP_EMISOR_SIN_CUIT'],
      ['sin punto de venta', { salesPoint: 0 }, 'EINVOICING.AFIP_SIN_PUNTO_VENTA'],
      ['sin número de comprobante', { nextNumber: 0 }, 'EINVOICING.AFIP_SIN_NUMERO_COMPROBANTE'],
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
