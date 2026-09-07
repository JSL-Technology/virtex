import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { Invoice, InvoiceType } from '../entities/invoice.entity';
import { CertificateVaultService } from '../../einvoicing/services/certificate-vault.service';
import { FiscalRangeService } from '../../einvoicing/services/fiscal-range.service';
import {
  FiscalDocumentRange,
  FiscalRangeSecretKind,
} from '../../einvoicing/entities/fiscal-document-range.entity';
import {
  FiscalEnvironment,
  FiscalRegimeSettings,
} from '../../einvoicing/entities/fiscal-regime-settings.entity';
import {
  ArgentinaNumberingAdapter,
  BrazilNumberingAdapter,
  ChileNumberingAdapter,
  ColombiaNumberingAdapter,
  EcuadorNumberingAdapter,
  MexicoNumberingAdapter,
  PeruNumberingAdapter,
} from './regime-numbering.adapter';
import { FiscalAssignmentContext } from '../interfaces/fiscal-adapter.interface';

/**
 * Fiscal numbering for the six markets besides the Dominican Republic.
 *
 * ## What this is actually testing
 *
 * Not that a function returns a string. That a fiscal number is handed out **once**, in the format
 * the authority reads, from a range the authority granted — and that the three ways it can go wrong
 * silently are all refused: a range that ran out, a range whose authorisation expired, and two
 * concurrent issuances racing for the same number.
 *
 * The last is the one no unit test with a mocked repository can reach, and it is the one that
 * produces a duplicate fiscal number in production. It is tested here against a real PostgreSQL,
 * with two real transactions, because `SELECT … FOR UPDATE` only means anything in a database.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('fiscal numbering across the seven regimes', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let ranges: FiscalRangeService;
  let vault: CertificateVaultService;
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

    // A real key, not a placeholder: the encrypted secret on a Chilean CAF range is decrypted for
    // real in the test that reads it back, so an AES round-trip that does not work would fail here.
    vault = new CertificateVaultService({
      get: (key: string) =>
        key === 'ECF_CERT_ENCRYPTION_KEY' ? 'clave-de-pruebas-suficientemente-larga' : undefined,
    } as unknown as ConfigService);
    ranges = new FiscalRangeService(vault);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const organization = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Régimen ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santiago',
        country: 'CL',
      }),
    );
    organizationId = organization.id;

    const customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        organizationId,
        companyName: 'Comprador',
        email: `comprador-${Date.now()}@example.test`,
        // Eleven digits: a Peruvian RUC, which is what separates a factura from a boleta.
        taxId: '20123456789',
      } as unknown as Customer),
    );
    customerId = customer.id;
  });

  /** An invoice good enough to be numbered. Nothing here is posted; numbering is upstream of that. */
  const invoiceFor = (overrides: Partial<Invoice> = {}): Invoice =>
    ({
      id: '00000000-0000-0000-0000-000000000000',
      organizationId,
      customerId,
      // Denormalised onto the document at issuance, exactly as `issueWithin` leaves it: the buyer's
      // identifier is what separates a Peruvian factura from a boleta, and reading it off a
      // relation that may not be loaded is how that decision silently becomes the wrong one.
      customerTaxId: '20123456789',
      type: InvoiceType.INVOICE,
      issueDate: '2026-09-06',
      currencyCode: 'CLP',
      subtotal: 100_000,
      tax: 19_000,
      total: 119_000,
      ...overrides,
    }) as unknown as Invoice;

  const contextFor = (
    manager: EntityManager,
    overrides: Partial<Invoice> = {},
    requestedType?: string,
  ): FiscalAssignmentContext => ({
    invoice: invoiceFor(overrides),
    organizationId,
    manager,
    requestedType: requestedType ?? null,
  });

  const settingsFor = async (partial: Partial<FiscalRegimeSettings>) =>
    dataSource.getRepository(FiscalRegimeSettings).save(
      dataSource.getRepository(FiscalRegimeSettings).create({
        organizationId,
        environment: FiscalEnvironment.CERTIFICATION,
        ...partial,
      }),
    );

  describe('Chile — SII', () => {
    const adapter = () => new ChileNumberingAdapter(ranges);

    it('draws the folio from the CAF authorised for the document type the sale actually is', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CL',
        documentType: '33',
        startsAt: 500,
        endsAt: 599,
        authorizationCode: 'CAF-2026-33',
      });

      const assignment = await dataSource.transaction((manager) =>
        adapter().assignSalesNumber(contextFor(manager)),
      );

      // A bare folio: the SII writes no prefix and no padding, and a padded folio is a different
      // number as far as the timbre is concerned.
      expect(assignment.ncf).toBe('500');
      expect(assignment.documentType).toBe('33');
    });

    it('refuses an afecta folio for an exempt sale, rather than quietly issuing the exenta one', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CL',
        documentType: '34',
        startsAt: 1,
        endsAt: 100,
      });

      // The caller asked for 33; the sale bears no VAT, so it is a 34. Issuing the 34 silently
      // would hand back a number from a range the caller never asked to draw from.
      await expect(
        dataSource.transaction((manager) =>
          adapter().assignSalesNumber(contextFor(manager, { tax: 0, total: 100_000 }, '33')),
        ),
      ).rejects.toThrow();
    });

    it('keeps the CAF key encrypted at rest and hands it back only when asked for', async () => {
      const cafXml = '<AUTORIZACION><CAF><RSASK>clave-privada-del-caf</RSASK></CAF></AUTORIZACION>';
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CL',
        documentType: '33',
        startsAt: 1,
        endsAt: 10,
        secret: cafXml,
        secretKind: FiscalRangeSecretKind.CAF_XML,
      });

      const stored = await dataSource.getRepository(FiscalDocumentRange).findOneByOrFail({
        organizationId,
        countryCode: 'CL',
        documentType: '33',
        isActive: true,
      });

      // The column must not contain the key. A database dump with a CAF in the clear lets whoever
      // reads it stamp documents in the taxpayer's name.
      expect(stored.encryptedSecret).toBeTruthy();
      expect(stored.encryptedSecret).not.toContain('clave-privada-del-caf');
      expect(vault.decrypt(stored.encryptedSecret as string).toString('utf8')).toBe(cafXml);

      const drawn = await dataSource.transaction((manager) =>
        ranges.drawNext(manager, {
          organizationId,
          countryCode: 'CL',
          documentType: '33',
          today: '2026-09-06',
          withSecret: true,
        }),
      );
      expect(drawn.secret).toBe(cafXml);
      expect(drawn.secretKind).toBe(FiscalRangeSecretKind.CAF_XML);
    });
  });

  describe('Peru — SUNAT', () => {
    const adapter = () => new PeruNumberingAdapter(ranges);

    it('writes the number as SUNAT reads it, series and eight-digit correlative', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'PE',
        documentType: '01',
        series: 'F001',
        startsAt: 123,
        endsAt: 999,
      });

      const assignment = await dataSource.transaction((manager) =>
        adapter().assignSalesNumber(contextFor(manager, { currencyCode: 'PEN' })),
      );

      expect(assignment.ncf).toBe('F001-00000123');
      expect(assignment.documentType).toBe('01');
    });

    it('issues a boleta when the buyer holds no RUC, and honours an explicit boleta for one who does', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'PE',
        documentType: '03',
        series: 'B001',
        startsAt: 1,
        endsAt: 999,
      });

      const consumer = await dataSource.getRepository(Customer).save(
        dataSource.getRepository(Customer).create({
          organizationId,
          companyName: 'Consumidor final',
          email: `consumidor-${Date.now()}@example.test`,
          taxId: null,
        } as unknown as Customer),
      );

      const inferred = await dataSource.transaction((manager) =>
        adapter().assignSalesNumber({
          invoice: invoiceFor({
            customerId: consumer.id,
            customerTaxId: null,
            currencyCode: 'PEN',
          }),
          organizationId,
          manager,
          requestedType: null,
        }),
      );
      expect(inferred.documentType).toBe('03');
      expect(inferred.ncf).toBe('B001-00000001');

      // SUNAT permits a boleta to a buyer with a RUC, so an explicit request is honoured rather
      // than overridden — unlike Chile, where the type is a property of the sale.
      const requested = await dataSource.transaction((manager) =>
        adapter().assignSalesNumber(contextFor(manager, { currencyCode: 'PEN' }, '03')),
      );
      expect(requested.documentType).toBe('03');
    });

    it('refuses a range whose series letter contradicts its document type', async () => {
      // An F series is a factura. Registering it as a boleta produces documents SUNAT rejects
      // before reading them — every document from that range, not one.
      await expect(
        ranges.register(dataSource.manager, {
          organizationId,
          countryCode: 'PE',
          documentType: '03',
          series: 'F002',
          startsAt: 1,
          endsAt: 10,
        }),
      ).rejects.toThrow();
    });
  });

  describe('Ecuador — SRI', () => {
    const adapter = () => new EcuadorNumberingAdapter(ranges);

    it('composes establishment, emission point and a nine-digit sequential', async () => {
      await settingsFor({ countryCode: 'EC', establishment: '001', emissionPoint: '002' });
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'EC',
        documentType: '01',
        startsAt: 45,
        endsAt: 1_000,
      });

      const assignment = await dataSource.transaction((manager) =>
        adapter().assignSalesNumber(contextFor(manager, { currencyCode: 'USD' })),
      );

      expect(assignment.ncf).toBe('001-002-000000045');
    });

    it('refuses to number at all when the emission point is not configured', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'EC',
        documentType: '01',
        startsAt: 1,
        endsAt: 10,
      });

      await expect(
        dataSource.transaction((manager) =>
          adapter().assignSalesNumber(contextFor(manager, { currencyCode: 'USD' })),
        ),
      ).rejects.toThrow();
    });
  });

  describe('Colombia — DIAN', () => {
    it('prefixes the consecutive with the resolution prefix', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CO',
        documentType: '01',
        series: 'SETP',
        startsAt: 990_000_000,
        endsAt: 990_001_000,
        authorizationCode: '18760000001',
        validUntil: '2027-12-31',
      });

      const assignment = await dataSource.transaction((manager) =>
        new ColombiaNumberingAdapter(ranges).assignSalesNumber(
          contextFor(manager, { currencyCode: 'COP' }),
        ),
      );

      expect(assignment.ncf).toBe('SETP990000000');
      // The resolution's expiry travels with the number: it is what the DIAN checks the document
      // against, and a number with no window cannot be filed.
      expect(assignment.expiresAt).toBe('2027-12-31');
    });
  });

  describe('Brazil — SEFAZ', () => {
    it('numbers within the série and writes the nNF bare', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'BR',
        documentType: '55',
        series: '1',
        startsAt: 7,
        endsAt: 999_999,
      });

      const assignment = await dataSource.transaction((manager) =>
        new BrazilNumberingAdapter(ranges).assignSalesNumber(
          contextFor(manager, { currencyCode: 'BRL' }),
        ),
      );

      expect(assignment.ncf).toBe('7');
      expect(assignment.documentType).toBe('55');
    });
  });

  describe('the two regimes that assign no number of their own', () => {
    it('Mexico records the comprobante type and no fiscal number, because the PAC assigns the UUID', async () => {
      const assignment = await new MexicoNumberingAdapter().assignSalesNumber(
        contextFor(dataSource.manager, { currencyCode: 'MXN' }),
      );

      expect(assignment.ncf).toBeNull();
      // Not the generic adapter's null: the document knows what it is, and it will be stamped.
      expect(assignment.documentType).toBe('I');

      const creditNote = await new MexicoNumberingAdapter().assignCreditNoteNumber({
        ...contextFor(dataSource.manager, { type: InvoiceType.CREDIT_NOTE, currencyCode: 'MXN' }),
        originalInvoice: invoiceFor(),
      });
      expect(creditNote.documentType).toBe('E');
    });

    it('Argentina records no number, because AFIP assigns it and a second counter would drift', async () => {
      const assignment = await new ArgentinaNumberingAdapter().assignSalesNumber(
        contextFor(dataSource.manager, { currencyCode: 'ARS' }),
      );

      expect(assignment.ncf).toBeNull();
      expect(assignment.documentType).toBe('01');
    });
  });

  describe('the invariants a fiscal number lives or dies by', () => {
    it('never hands the same number to two concurrent issuances', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CL',
        documentType: '33',
        startsAt: 1,
        endsAt: 100,
      });

      // Two real transactions, started together. Without `FOR UPDATE` both read `current_sequence`
      // as 0 and both return folio 1 — the SII accepts the first document and rejects the second,
      // and the taxpayer explains a duplicate to an inspector. No mock can reproduce this.
      const draw = () =>
        dataSource.transaction((manager) =>
          new ChileNumberingAdapter(ranges).assignSalesNumber(contextFor(manager)),
        );

      const [first, second] = await Promise.all([draw(), draw()]);
      expect(new Set([first.ncf, second.ncf]).size).toBe(2);
      expect([first.ncf, second.ncf].sort()).toEqual(['1', '2']);
    });

    it('refuses once the range is exhausted, instead of numbering past its upper bound', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CL',
        documentType: '33',
        startsAt: 1,
        endsAt: 2,
      });

      const draw = () =>
        dataSource.transaction((manager) =>
          new ChileNumberingAdapter(ranges).assignSalesNumber(contextFor(manager)),
        );

      expect((await draw()).ncf).toBe('1');
      expect((await draw()).ncf).toBe('2');
      await expect(draw()).rejects.toThrow();
    });

    it('refuses a range whose authorisation has expired, however many numbers are left', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CO',
        documentType: '01',
        series: 'SETP',
        startsAt: 1,
        endsAt: 1_000_000,
        validUntil: '2020-01-31',
      });

      await expect(
        dataSource.transaction((manager) =>
          new ColombiaNumberingAdapter(ranges).assignSalesNumber(
            contextFor(manager, { currencyCode: 'COP' }),
          ),
        ),
      ).rejects.toThrow();
    });

    it('refuses to issue at all when the tenant holds no range for the type', async () => {
      await expect(
        dataSource.transaction((manager) =>
          new ChileNumberingAdapter(ranges).assignSalesNumber(contextFor(manager)),
        ),
      ).rejects.toThrow();
    });

    it('supersedes the previous range rather than deleting it, so past documents stay traceable', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CL',
        documentType: '33',
        startsAt: 1,
        endsAt: 10,
        authorizationCode: 'CAF-A',
      });
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CL',
        documentType: '33',
        startsAt: 11,
        endsAt: 20,
        authorizationCode: 'CAF-B',
      });

      const all = await dataSource.getRepository(FiscalDocumentRange).find({
        where: { organizationId, countryCode: 'CL', documentType: '33' },
        order: { startsAt: 'ASC' },
      });

      expect(all).toHaveLength(2);
      expect(all[0].authorizationCode).toBe('CAF-A');
      expect(all[0].isActive).toBe(false);
      expect(all[1].isActive).toBe(true);

      const assignment = await dataSource.transaction((manager) =>
        new ChileNumberingAdapter(ranges).assignSalesNumber(contextFor(manager)),
      );
      expect(assignment.ncf).toBe('11');
    });

    it('refuses a document type that belongs to another market', async () => {
      await ranges.register(dataSource.manager, {
        organizationId,
        countryCode: 'CL',
        documentType: '33',
        startsAt: 1,
        endsAt: 10,
      });

      // `E31` is a Dominican comprobante. Before the interface widened, the DTO's `@IsEnum(NcfType)`
      // would have accepted it here and refused a legitimate Chilean `33`.
      await expect(
        dataSource.transaction((manager) =>
          new ChileNumberingAdapter(ranges).assignSalesNumber(contextFor(manager, {}, 'E31')),
        ),
      ).rejects.toThrow();
    });
  });
});
