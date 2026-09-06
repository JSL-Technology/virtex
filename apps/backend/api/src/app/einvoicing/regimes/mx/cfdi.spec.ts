import * as crypto from 'crypto';
import { CfdiBuilder, CfdiBuildInput } from './cfdi.builder';
import { XmlSignatureService } from '../xml-signature.service';
import { Invoice, InvoiceType } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';

/**
 * CFDI 4.0 — the comprobante, and the seal the SAT verifies.
 *
 * These assert the two things that decide whether a document is accepted: that every attribute the
 * schema requires is present and carries the value the invoice actually holds, and that the seal
 * verifies against the cadena original recomputed **from the transmitted XML** — which is what the
 * PAC and the SAT do. A test that checked only for the presence of a `Sello` attribute would pass
 * on a document sealed over the wrong projection, which is the failure that produces a rejection
 * saying "sello inválido" while every figure in the document looks right.
 */
describe('CFDI 4.0', () => {
  const builder = new CfdiBuilder();
  const signatures = new XmlSignatureService();

  const organization = {
    id: 'org-1',
    legalName: 'DEMOSTRACIONES DEL NORTE SA DE CV',
    taxId: 'AAA010101AAA',
    postalCode: '64000',
    fiscalProfile: { regimenFiscal: '601' },
  } as unknown as Organization;

  const customer = {
    id: 'cus-1',
    companyName: 'COMPRADORA DEL BAJIO SA DE CV',
    taxId: 'BBB020202BB1',
    postalCode: '37000',
  } as unknown as Customer;

  const invoice = {
    id: 'inv-1',
    invoiceNumber: 'F-000123',
    customerId: 'cus-1',
    issueDate: '2026-06-10',
    currencyCode: 'MXN',
    exchangeRate: 1,
    subtotal: 1_000,
    discountTotal: 0,
    taxedTotal: 1_000,
    tax: 160,
    total: 1_160,
    type: InvoiceType.INVOICE,
    lineItems: [
      {
        description: 'Servicio de consultoría',
        quantity: 1,
        price: 1_000,
        lineSubtotal: 1_000,
        taxableBase: 1_000,
        taxRate: 0.16,
        taxAmount: 160,
        discountAmount: 0,
        fiscalCodes: { claveProdServ: '80101500', claveUnidad: 'E48' },
      },
    ],
  } as unknown as Invoice;

  const input = (overrides: Partial<CfdiBuildInput> = {}): CfdiBuildInput => ({
    invoice,
    organization,
    customer,
    issuerRegime: '601',
    issuingPostalCode: '64000',
    certificateNumber: '30001000000400002435',
    certificateBase64: 'TUlJRmFrZQ==',
    ...overrides,
  });

  describe('the comprobante', () => {
    it('carries the attributes the schema requires, with the invoice’s own figures', () => {
      const xml = builder.build(input());

      expect(xml).toContain('Version="4.0"');
      expect(xml).toContain('Folio="F-000123"');
      expect(xml).toContain('SubTotal="1000.00"');
      expect(xml).toContain('Total="1160.00"');
      expect(xml).toContain('Moneda="MXN"');
      expect(xml).toContain('TipoDeComprobante="I"');
      expect(xml).toContain('LugarExpedicion="64000"');
      expect(xml).toContain('NoCertificado="30001000000400002435"');
      // The SAT reads the date as the issuing place's local time, with no zone designator.
      expect(xml).toMatch(/Fecha="2026-06-10T\d{2}:\d{2}:\d{2}"/);
    });

    it('names both parties with their RFC, regime and postal code', () => {
      const xml = builder.build(input());

      expect(xml).toContain('Rfc="AAA010101AAA"');
      expect(xml).toContain('RegimenFiscal="601"');
      expect(xml).toContain('Rfc="BBB020202BB1"');
      expect(xml).toContain('DomicilioFiscalReceptor="37000"');
    });

    it('states the tax per concepto and again in the document summary', () => {
      const xml = builder.build(input());

      // `002` is IVA. `Tasa` with the rate to six decimals, and the base it was charged on.
      expect(xml).toContain('Impuesto="002"');
      expect(xml).toContain('TipoFactor="Tasa"');
      expect(xml).toContain('TasaOCuota="0.160000"');
      expect(xml).toContain('Base="1000.00"');
      expect(xml).toContain('TotalImpuestosTrasladados="160.00"');
      // Object of tax, because it bears some.
      expect(xml).toContain('ObjetoImp="02"');
    });

    it('issues a credit note as an egreso', () => {
      const xml = builder.build(
        input({ invoice: { ...invoice, type: InvoiceType.CREDIT_NOTE } as Invoice }),
      );

      expect(xml).toContain('TipoDeComprobante="E"');
    });

    it('carries the exchange rate only when the document is not in pesos', () => {
      expect(builder.build(input())).not.toContain('TipoCambio');

      const inDollars = builder.build(
        input({
          invoice: { ...invoice, currencyCode: 'USD', exchangeRate: 17.5 } as Invoice,
        }),
      );
      expect(inDollars).toContain('Moneda="USD"');
      expect(inDollars).toContain('TipoCambio="17.500000"');
    });

    it('refuses a line with no SAT catalogue codes rather than inventing them', () => {
      // `ClaveProdServ` is drawn from a catalogue of some fifty thousand entries. A code invented
      // here produces a document that stamps and misdescribes what was sold.
      const noCodes = {
        ...invoice,
        lineItems: [{ ...invoice.lineItems[0], fiscalCodes: null }],
      } as unknown as Invoice;

      expect(() => builder.build(input({ invoice: noCodes }))).toThrow(
        expect.objectContaining({ messageKey: 'EINVOICING.CFDI_LINEA_SIN_CLAVE_SAT' }),
      );
    });

    it.each([
      ['el emisor sin RFC', { organization: { ...organization, taxId: null } as unknown as Organization }, 'EINVOICING.CFDI_EMISOR_SIN_RFC'],
      ['el receptor sin RFC', { customer: { ...customer, taxId: null } as unknown as Customer }, 'EINVOICING.CFDI_RECEPTOR_SIN_RFC'],
      ['sin régimen fiscal', { issuerRegime: '' }, 'EINVOICING.CFDI_SIN_REGIMEN_FISCAL'],
      ['sin lugar de expedición', { issuingPostalCode: '' }, 'EINVOICING.CFDI_SIN_LUGAR_EXPEDICION'],
      ['el receptor sin código postal', { customer: { ...customer, postalCode: null } as unknown as Customer }, 'EINVOICING.CFDI_RECEPTOR_SIN_CODIGO_POSTAL'],
    ])('refuses to build with %s', (_name, overrides, messageKey) => {
      expect(() => builder.build(input(overrides as Partial<CfdiBuildInput>))).toThrow(
        expect.objectContaining({ messageKey }),
      );
    });
  });

  describe('the seal', () => {
    let privateKeyPem: string;
    let certificatePem: string;

    beforeAll(() => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      const forge = require('node-forge') as typeof import('node-forge');
      const cert = forge.pki.createCertificate();
      cert.publicKey = forge.pki.publicKeyFromPem(
        publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      );
      cert.serialNumber = '01';
      cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
      cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
      const attrs = [{ name: 'commonName', value: 'CSD DE PRUEBAS' }];
      cert.setSubject(attrs);
      cert.setIssuer(attrs);
      cert.sign(forge.pki.privateKeyFromPem(privateKeyPem), forge.md.sha256.create());
      certificatePem = forge.pki.certificateToPem(cert);
    });

    it('is verifiable against the cadena recomputed from the transmitted document', () => {
      const xml = builder.build(input());
      const cadena = builder.cadenaOriginal(xml);
      const sello = signatures.seal(cadena, { privateKeyPem, certificatePem });

      // Exactly what the PAC does: take the XML as transmitted, recompute the cadena, verify.
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(builder.cadenaOriginal(xml), 'utf8');
      verifier.end();
      expect(verifier.verify(certificatePem, Buffer.from(sello, 'base64'))).toBe(true);
    });

    it('is invalidated by any change to the document after sealing', () => {
      const xml = builder.build(input());
      const sello = signatures.seal(builder.cadenaOriginal(xml), { privateKeyPem, certificatePem });

      // A total edited after sealing. This is the whole reason the seal exists.
      const tampered = xml.replace('Total="1160.00"', 'Total="16.00"');

      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(builder.cadenaOriginal(tampered), 'utf8');
      verifier.end();
      expect(verifier.verify(certificatePem, Buffer.from(sello, 'base64'))).toBe(false);
    });

    it('builds the cadena in the delimited shape the SAT publishes', () => {
      const cadena = builder.cadenaOriginal(builder.build(input()));

      // `||` at each end, `|` between values, and no namespace declarations inside.
      expect(cadena.startsWith('||')).toBe(true);
      expect(cadena.endsWith('||')).toBe(true);
      expect(cadena).not.toContain('http://www.sat.gob.mx/cfd/4');
      expect(cadena).toContain('4.0');
      expect(cadena).toContain('AAA010101AAA');
      expect(cadena).toContain('1160.00');
    });

    it('leaves the seal itself out of the projection it is computed over', () => {
      // Otherwise the seal would have to sign itself, which cannot terminate.
      const xml = builder.build(input());
      const sealed = xml.replace('<cfdi:Comprobante ', '<cfdi:Comprobante Sello="ABC123" ');

      expect(builder.cadenaOriginal(sealed)).toBe(builder.cadenaOriginal(xml));
    });
  });
});
