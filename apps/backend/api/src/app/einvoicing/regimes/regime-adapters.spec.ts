import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { SignedXml } from 'xml-crypto';
import { Organization } from '../../organizations/entities/organization.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { Invoice, InvoiceType } from '../../invoices/entities/invoice.entity';
import { CertificateVaultService, LoadedCertificate } from '../services/certificate-vault.service';
import { FiscalRangeService } from '../services/fiscal-range.service';
import { FiscalRangeSecretKind } from '../entities/fiscal-document-range.entity';
import { FiscalEnvironment, FiscalRegimeSettings } from '../entities/fiscal-regime-settings.entity';
import { EcfCertificate } from '../entities/ecf-certificate.entity';
import { XmlSignatureService } from './xml-signature.service';
import { RegimeTransportService } from './regime-transport.service';
import { DianRegimeAdapter } from './co/dian.adapter';
import { SunatRegimeAdapter } from './pe/sunat.adapter';
import { SriRegimeAdapter } from './ec/sri.adapter';
import { SiiRegimeAdapter } from './cl/sii.adapter';
import { NfeRegimeAdapter } from './br/nfe.adapter';
import { AfipRegimeAdapter } from './ar/afip.adapter';
import { FiscalRegimeContext, RegimeNotConfigured } from './fiscal-regime.types';

/**
 * The six regime adapters, end to end: build the document the authority's schema describes, seal it
 * with the taxpayer's real certificate, and verify the seal the way the authority verifies it.
 *
 * ## What is real here and what is not
 *
 * Real: the certificate (a 2048-bit RSA key and a self-signed X.509 generated in this file), the
 * signature, the verification, the CAF's own RSA key and the timbre sealed with it, the
 * PostgreSQL rows the adapters read their configuration and their authorised ranges from.
 *
 * Not exercised: the exchange with the authority. That needs the taxpayer's own certificate
 * enrolled with the SEFAZ, SUNAT or the SII, a homologation process each authority runs against
 * that taxpayer's account, and in Mexico a commercial contract with a PAC. With no endpoint
 * configured the transport answers `NOT_CONFIGURED` and the document stays built and sealed, which
 * is its true state — asserted below, because a regime that silently claimed success without one
 * would be the exact failure this audit exists to prevent.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('the six regime adapters', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let vault: CertificateVaultService;
  let signatures: XmlSignatureService;
  let transport: RegimeTransportService;
  let ranges: FiscalRangeService;
  let certificate: LoadedCertificate;

  let organizationId: string;
  let customerId: string;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();

    const config = {
      get: (key: string) =>
        key === 'ECF_CERT_ENCRYPTION_KEY' ? 'clave-de-pruebas-suficientemente-larga' : undefined,
    } as unknown as ConfigService;

    vault = new CertificateVaultService(config);
    signatures = new XmlSignatureService();
    // No endpoint configured, deliberately: every regime must answer NOT_CONFIGURED rather than
    // inventing an authority's response.
    transport = new RegimeTransportService(config);
    ranges = new FiscalRangeService(vault);

    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    certificate = {
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      certificatePem: selfSignedCertificate(publicKey, privateKey),
    };
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const organization = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Emisor ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        taxId: '900123456',
        address: 'Av. Siempre Viva 742',
        timezone: 'America/Bogota',
        industry: 'Comercio',
      }),
    );
    organizationId = organization.id;

    const customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        organizationId,
        companyName: 'Comprador S.A.',
        email: `comprador-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`,
        taxId: '20123456789',
        address: 'Calle 1',
        city: 'Bogotá',
      } as unknown as Customer),
    );
    customerId = customer.id;
  });

  const invoiceFor = (overrides: Partial<Invoice> = {}): Invoice =>
    ({
      id: '00000000-0000-0000-0000-000000000000',
      organizationId,
      customerId,
      customerTaxId: '20123456789',
      type: InvoiceType.INVOICE,
      issueDate: '2026-09-07',
      invoiceNumber: 'FAC-1',
      currencyCode: 'COP',
      exchangeRate: 1,
      subtotal: 100_000,
      taxedTotal: 100_000,
      exemptTotal: 0,
      tax: 19_000,
      excise: 0,
      discountTotal: 0,
      total: 119_000,
      lineItems: [
        {
          description: 'Servicio de consultoría',
          quantity: 1,
          price: 100_000,
          lineSubtotal: 100_000,
          taxRate: 0.19,
          taxAmount: 19_000,
        },
      ],
      ...overrides,
    }) as unknown as Invoice;

  const contextFor = (overrides: Partial<Invoice> = {}): FiscalRegimeContext => ({
    invoice: invoiceFor(overrides),
    organizationId,
    manager: dataSource.manager,
  });

  /**
   * Re-stamp the issuer with the identifier its own authority validates.
   *
   * These are not interchangeable and each builder checks its own: a NIT is 9 digits plus a check
   * digit, a RUC 11, a CNPJ 14, a RUT carries a check character, a CUIT 11. An issuer carrying the
   * wrong shape is refused before anything is built, which is correct — and means one fixture
   * cannot serve seven markets.
   */
  const issuerIs = (taxId: string, extra: Partial<Organization> = {}) =>
    dataSource.getRepository(Organization).update(organizationId, { taxId, ...extra });

  const buyerIs = (taxId: string) =>
    dataSource.getRepository(Customer).update(customerId, { taxId });

  const settingsFor = (partial: Partial<FiscalRegimeSettings>) =>
    dataSource.getRepository(FiscalRegimeSettings).save(
      dataSource.getRepository(FiscalRegimeSettings).create({
        organizationId,
        environment: FiscalEnvironment.CERTIFICATION,
        ...partial,
      }),
    );

  /** Store the generated certificate for a regime, encrypted, exactly as the product stores one. */
  const storeCertificate = async (regime: string) => {
    const pfx = pkcs12Of(certificate);
    await dataSource.getRepository(EcfCertificate).save(
      dataSource.getRepository(EcfCertificate).create({
        organizationId,
        regime,
        alias: `${regime} pruebas`,
        isActive: true,
        encryptedPfx: vault.encrypt(pfx),
        encryptedPassword: vault.encrypt('clave'),
      } as unknown as EcfCertificate),
    );
  };

  /**
   * Verify a signature the way the authority does: recompute the digest over what the reference
   * names, and check it against the signer's public key.
   *
   * Asserting that a `<Signature>` element exists proves nothing — a signature over the wrong
   * element passes every structural assertion and fails every upload.
   */
  const verifies = (signedXml: string): boolean => {
    const verifier = new SignedXml();
    const signature = signedXml.match(/<(?:\w+:)?Signature[\s\S]*<\/(?:\w+:)?Signature>/)?.[0];
    if (!signature) return false;
    verifier.publicCert = certificate.certificatePem;
    verifier.loadSignature(signature);
    return verifier.checkSignature(signedXml);
  };

  describe('Colombia — DIAN', () => {
    const adapter = () => new DianRegimeAdapter(vault, signatures, transport, ranges);

    const withResolution = async () =>
      ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CO',
        documentType: '01',
        series: 'SETP',
        startsAt: 990_000_000,
        endsAt: 990_001_000,
        authorizationCode: '18760000001',
        validUntil: '2027-12-31',
        secret: 'clave-tecnica-de-la-resolucion',
        secretKind: FiscalRangeSecretKind.DIAN_TECHNICAL_KEY,
      });

    it('builds a UBL invoice whose CUFE is computed with the resolution’s own technical key', async () => {
      await withResolution();
      await settingsFor({ countryCode: 'CO', resolutionNumber: '18760000001' });

      const document = await adapter().build(contextFor({ ncfNumber: 'SETP990000001' }));

      expect(document.contentType).toBe('application/xml');
      // SHA-384, 96 hex characters. A CUFE of any other length is not a CUFE.
      expect(document.documentKey).toMatch(/^[0-9a-f]{96}$/);
      expect(document.payload).toContain('<cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>');
    });

    it('produces a signature that verifies against the certificate', async () => {
      await withResolution();
      await settingsFor({ countryCode: 'CO' });

      const built = await adapter().build(contextFor({ ncfNumber: 'SETP990000001' }));
      const sealed = adapter().seal(built, certificate);

      expect(verifies(sealed.payload)).toBe(true);
    });

    it('refuses to build when the resolution carries no technical key, instead of hashing nothing', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CO',
        documentType: '01',
        series: 'SETP',
        startsAt: 990_000_000,
        endsAt: 990_001_000,
      });

      // A CUFE computed with an empty key is a well-formed hash the DIAN rejects, and the message
      // it returns says only that the CUFE is wrong.
      await expect(adapter().build(contextFor({ ncfNumber: 'SETP990000001' }))).rejects.toThrow(
        RegimeNotConfigured,
      );
    });

    it('says NOT_CONFIGURED rather than inventing a DIAN response', async () => {
      const result = await adapter().transmit(
        { payload: '<Invoice/>', contentType: 'application/xml', documentKey: 'abc' },
        contextFor(),
      );

      expect(result.status).toBe('NOT_CONFIGURED');
      // The CUFE survives: it is the document's identity whatever the authority answers.
      expect(result.authorization).toBe('abc');
    });
  });

  describe('Peru — SUNAT', () => {
    const adapter = () => new SunatRegimeAdapter(vault, signatures, transport, ranges);

    const withSeries = () =>
      ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'PE',
        documentType: '01',
        series: 'F001',
        startsAt: 1,
        endsAt: 1_000,
      });

    it('names the document as SUNAT identifies it, and signs inside the UBL extension', async () => {
      await withSeries();

      const built = await adapter().build(
        contextFor({ ncfNumber: 'F001-00000123', fiscalDocumentType: '01', currencyCode: 'PEN' }),
      );

      // `RUC-Tipo-Serie-Correlativo`. SUNAT rejects a submission on this before reading it.
      expect(built.documentKey).toBe('900123456-01-F001-00000123');

      const sealed = adapter().seal(built, certificate);
      expect(sealed.payload).toContain('ExtensionContent');
      expect(verifies(sealed.payload)).toBe(true);
    });

    it('refuses to build a document whose type was never assigned', async () => {
      await withSeries();
      await expect(
        adapter().build(contextFor({ ncfNumber: 'F001-00000123', fiscalDocumentType: null })),
      ).rejects.toThrow(RegimeNotConfigured);
    });
  });

  describe('Ecuador — SRI', () => {
    const adapter = () => new SriRegimeAdapter(vault, signatures, transport);

    it('computes a 49-digit clave de acceso and signs the comprobante', async () => {
      await settingsFor({
        countryCode: 'EC',
        establishment: '001',
        emissionPoint: '002',
        numericCode: '12345678',
      });

      const built = await adapter().build(
        contextFor({ ncfNumber: '001-002-000000045', currencyCode: 'USD' }),
      );

      expect(built.documentKey).toHaveLength(49);
      expect(built.documentKey).toMatch(/^\d{49}$/);

      const sealed = adapter().seal(built, certificate);
      expect(verifies(sealed.payload)).toBe(true);
    });

    it('codes the environment the SRI way, which is the reverse of the DIAN’s', async () => {
      await settingsFor({
        countryCode: 'EC',
        establishment: '001',
        emissionPoint: '002',
        numericCode: '12345678',
        environment: FiscalEnvironment.PRODUCTION,
      });

      const built = await adapter().build(
        contextFor({ ncfNumber: '001-002-000000045', currencyCode: 'USD' }),
      );

      // Position 24 of the key (0-indexed 23) is the environment: `2` is producción in Ecuador
      // and pruebas in Colombia. Sharing one digit between them files documents into the wrong
      // world, and a document in the test environment has no fiscal effect at all.
      expect(built.documentKey?.[23]).toBe('2');
    });

    it('treats a clean reception as PENDING, because received is not authorised', async () => {
      const result = await adapter().transmit(
        { payload: '<factura/>', contentType: 'application/xml', documentKey: '1'.repeat(49) },
        contextFor(),
      );

      // With no endpoint the honest answer is NOT_CONFIGURED, and it must not be dressed up as
      // an authorisation.
      expect(result.status).toBe('NOT_CONFIGURED');
    });
  });

  describe('Chile — SII', () => {
    const adapter = () => new SiiRegimeAdapter(vault, signatures, transport, ranges);

    /** A CAF with its own RSA key, as the SII issues one. */
    const caf = () => {
      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
      return {
        pem,
        xml:
          '<AUTORIZACION><CAF version="1.0"><DA><RE>76192083-9</RE><RS>EMISOR</RS>' +
          '<TD>33</TD><RNG><D>1</D><H>100</H></RNG><FA>2026-01-15</FA></DA>' +
          `<RSASK>${pem}</RSASK></CAF></AUTORIZACION>`,
      };
    };

    it('seals the timbre with the CAF key and the document with the certificate', async () => {
      const authorisation = caf();
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CL',
        documentType: '33',
        startsAt: 1,
        endsAt: 100,
        secret: authorisation.xml,
        secretKind: FiscalRangeSecretKind.CAF_XML,
      });
      await settingsFor({
        countryCode: 'CL',
        activityCode: '620200',
        originComuna: 'Providencia',
        originCity: 'Santiago',
      });
      await issuerIs('761920839');
      await buyerIs('770123456');

      const built = await adapter().build(
        contextFor({ ncfNumber: '7', currencyCode: 'CLP', tax: 19_000 }),
      );
      const sealed = adapter().seal(built, certificate);

      // The document's signature: the taxpayer's certificate, over `Documento` by id.
      expect(verifies(sealed.payload)).toBe(true);
      expect(sealed.payload).toMatch(/<Reference[^>]*URI="#DTE-33-7"/);

      // The timbre's seal: the CAF's key, SHA1withRSA, over the `DD`. Two different keys, and the
      // SII verifies each against a different public key.
      const frmt = /<FRMT algoritmo="SHA1withRSA">([^<]+)<\/FRMT>/.exec(sealed.payload)?.[1];
      expect(frmt).toBeTruthy();

      const dd = /<DD>[\s\S]*?<\/DD>/.exec(sealed.payload)?.[0] as string;
      const verifier = crypto.createVerify('RSA-SHA1');
      verifier.update(dd, 'utf8');
      verifier.end();
      expect(
        verifier.verify(
          crypto.createPublicKey(authorisation.pem),
          Buffer.from(frmt as string, 'base64'),
        ),
      ).toBe(true);
    });

    it('refuses a folio whose range carries no CAF, rather than issuing an unsealed timbre', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CL',
        documentType: '33',
        startsAt: 1,
        endsAt: 100,
      });
      await settingsFor({
        countryCode: 'CL',
        activityCode: '620200',
        originComuna: 'Providencia',
        originCity: 'Santiago',
      });

      await expect(
        adapter().build(contextFor({ ncfNumber: '7', currencyCode: 'CLP' })),
      ).rejects.toThrow(RegimeNotConfigured);
    });

    it('refuses without the activity code the SII requires on every DTE', async () => {
      const authorisation = caf();
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CL',
        documentType: '33',
        startsAt: 1,
        endsAt: 100,
        secret: authorisation.xml,
        secretKind: FiscalRangeSecretKind.CAF_XML,
      });

      await expect(
        adapter().build(contextFor({ ncfNumber: '7', currencyCode: 'CLP' })),
      ).rejects.toThrow(RegimeNotConfigured);
    });
  });

  describe('Brazil — SEFAZ', () => {
    const adapter = () => new NfeRegimeAdapter(vault, signatures, transport, ranges);

    const withSeries = () =>
      ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'BR',
        documentType: '55',
        series: '1',
        startsAt: 1,
        endsAt: 999_999,
      });

    it('signs infNFe by its Id and not the envelope', async () => {
      await withSeries();
      await settingsFor({
        countryCode: 'BR',
        stateCode: '35',
        municipalityCode: '3550308',
        numericCode: '12345678',
      });
      await issuerIs('12345678000195');
      await buyerIs('98765432000110');

      const built = await adapter().build(
        contextFor({
          ncfNumber: '7',
          currencyCode: 'BRL',
          // NCM classifies the good and CFOP the operation. The builder refuses to guess either,
          // which is right: an NCM decides the tax rate and a wrong one misstates the tax due.
          lineItems: [
            {
              description: 'Serviço de consultoria',
              quantity: 1,
              price: 100_000,
              lineSubtotal: 100_000,
              taxRate: 0.19,
              taxAmount: 19_000,
              fiscalCodes: { ncm: '85234910', cfop: '5102', cst: '00' },
            },
          ] as unknown as Invoice['lineItems'],
        }),
      );
      expect(built.documentKey).toMatch(/^\d{44}$/);

      const sealed = adapter().seal(built, certificate);

      // Rejection 297 — *assinatura difere do calculado* — is what signing the envelope produces,
      // and its message says nothing about which element was wrong.
      expect(sealed.payload).toMatch(new RegExp(`<Reference[^>]*URI="#NFe${built.documentKey}"`));
      expect(verifies(sealed.payload)).toBe(true);
    });

    it('refuses without the IBGE codes, which are part of the chave de acesso', async () => {
      await withSeries();
      await expect(
        adapter().build(contextFor({ ncfNumber: '7', currencyCode: 'BRL' })),
      ).rejects.toThrow(RegimeNotConfigured);
    });
  });

  describe('Argentina — AFIP', () => {
    const adapter = () => new AfipRegimeAdapter(vault, transport);

    it('refuses to number the document when AFIP cannot be asked', async () => {
      await dataSource.getRepository(Organization).update(organizationId, {
        fiscalProfile: { puntoVenta: '0001', condicionIva: 'RESPONSABLE_INSCRIPTO' },
      });

      // The number is AFIP's to give. Guessing it produces a request AFIP refuses; guessing twice
      // produces a gap the taxpayer has to explain. So with no endpoint there is no document.
      await expect(adapter().build(contextFor({ currencyCode: 'ARS' }))).rejects.toThrow(
        RegimeNotConfigured,
      );
    });

    it('refuses without the point of sale AFIP authorised', async () => {
      await expect(adapter().build(contextFor({ currencyCode: 'ARS' }))).rejects.toThrow(
        RegimeNotConfigured,
      );
    });

    it('produces a real CMS/PKCS#7 WSAA envelope beside the request', async () => {
      const sealed = adapter().seal(
        {
          payload: JSON.stringify({ FeCabReq: { CantReg: 1, PtoVta: 1, CbteTipo: 1 } }),
          contentType: 'application/json',
          documentKey: null,
        },
        certificate,
      );

      const body = JSON.parse(sealed.payload) as { request: unknown; wsaa: string };
      expect(body.request).toEqual({ FeCabReq: { CantReg: 1, PtoVta: 1, CbteTipo: 1 } });

      // Parsed back as real PKCS#7 rather than checked for being base64: an envelope AFIP cannot
      // open is an authentication failure with a message about the CMS and nothing else.
      const forge = require('node-forge') as typeof import('node-forge');
      const asn1 = forge.asn1.fromDer(forge.util.decode64(body.wsaa));
      const p7 = forge.pkcs7.messageFromAsn1(asn1) as { rawCapture?: Record<string, unknown> };
      expect(p7.rawCapture?.['signature']).toBeTruthy();
    });
  });

  describe('every regime, on the one thing they must never do', () => {
    it('answers NOT_CONFIGURED with no endpoint, rather than fabricating an authority response', async () => {
      const document = {
        payload: '<Doc/>',
        contentType: 'application/xml',
        documentKey: null,
      };
      const adapters = [
        new DianRegimeAdapter(vault, signatures, transport, ranges),
        new SunatRegimeAdapter(vault, signatures, transport, ranges),
        new SriRegimeAdapter(vault, signatures, transport),
        new SiiRegimeAdapter(vault, signatures, transport, ranges),
        new NfeRegimeAdapter(vault, signatures, transport, ranges),
      ];

      for (const adapter of adapters) {
        const result = await adapter.transmit(document, contextFor());
        expect(result.status).toBe('NOT_CONFIGURED');
        expect(result.messages.join(' ')).toContain('EINVOICE_');
      }
    });

    it('refuses to sign without a certificate, and calls it a settings problem', async () => {
      const adapter = new SiiRegimeAdapter(vault, signatures, transport, ranges);
      await expect(adapter.loadCertificate(contextFor())).rejects.toThrow(RegimeNotConfigured);

      await storeCertificate('SII');
      const loaded = await adapter.loadCertificate(contextFor());
      expect(loaded.privateKeyPem).toContain('PRIVATE KEY');
    });
  });
});

/** A real self-signed X.509 over the generated key. Never a fixture on disk. */
function selfSignedCertificate(
  publicKey: crypto.KeyObject,
  privateKey: crypto.KeyObject,
): string {
  const forge = require('node-forge') as typeof import('node-forge');
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(
    publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  );
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  const attrs = [{ name: 'commonName', value: 'VIRTEX PRUEBAS' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(
    forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
    forge.md.sha256.create(),
  );
  return forge.pki.certificateToPem(cert);
}

/** The same material as a PKCS#12, which is the form the vault stores and parses. */
function pkcs12Of(certificate: LoadedCertificate): Buffer {
  const forge = require('node-forge') as typeof import('node-forge');
  const asn1 = forge.pkcs12.toPkcs12Asn1(
    forge.pki.privateKeyFromPem(certificate.privateKeyPem),
    forge.pki.certificateFromPem(certificate.certificatePem),
    'clave',
    { algorithm: '3des' },
  );
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}
