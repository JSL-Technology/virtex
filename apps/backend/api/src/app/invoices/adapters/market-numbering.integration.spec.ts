import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';
import { createTestOrganization, describeWithDb, openTestDataSource } from '../../common/database/testing/integration-db';
import { Invoice, InvoiceType } from '../entities/invoice.entity';
import { CertificateVaultService } from '../../einvoicing/services/certificate-vault.service';
import { FiscalRangeRegistration, FiscalRangeService } from '../../einvoicing/services/fiscal-range.service';
import { FiscalDocumentRange, FiscalRangeSecretKind } from '../../einvoicing/entities/fiscal-document-range.entity';
import { FiscalEnvironment, FiscalRegimeSettings } from '../../einvoicing/entities/fiscal-regime-settings.entity';
import { IssuedFiscalNumbersRegistry } from '../../contracts/fiscal-records/issued-fiscal-numbers.registry';
import { InvoiceIssuedFiscalNumbers } from '../issued-fiscal-numbers.source';
import { PosIssuedFiscalNumbers } from '../../pos/issued-fiscal-numbers.source';
import { FiscalAdapterFactory } from './fiscal-adapter.factory';
import { FiscalAdapter, FiscalAssignmentContext } from '../interfaces/fiscal-adapter.interface';

/**
 * Fiscal numbering in every market that numbers from a range, against a real PostgreSQL.
 *
 * ## What this is actually testing
 *
 * Not that a function returns a string. That a fiscal number is handed out **once**, in the format
 * the authority reads, from a range the authority granted — and that every way it can go wrong
 * silently is refused: a range that ran out, a range whose authorisation lapsed, two concurrent
 * issuances racing for one number, a range registered over another or over numbers already on
 * documents, two submissions of the same range at once.
 *
 * The races are the ones no unit test with a mocked repository can reach, and they are the ones
 * that produce a duplicate fiscal number in production. They are tested here with real
 * transactions, because `SELECT … FOR UPDATE` and an advisory lock only mean anything in a database.
 *
 * One engine numbers every market (`MarketFiscalAdapter`, through `FiscalAdapterFactory`); what
 * differs is each market's declared numbering, so each market is exercised through the same door.
 */
describeWithDb('fiscal numbering, one engine for every market', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let ranges: FiscalRangeService;
  let vault: CertificateVaultService;
  let factory: FiscalAdapterFactory;
  let organizationId: string;
  let customerId: string;
  const TODAY = '2026-11-09';

  beforeAll(async () => {
    dataSource = await openTestDataSource();

    // A real key, not a placeholder: the encrypted secret on a Chilean CAF range is decrypted for
    // real in the test that reads it back, so an AES round-trip that does not work would fail here.
    vault = new CertificateVaultService({
      get: (key: string) => (key === 'ECF_CERT_ENCRYPTION_KEY' ? 'clave-de-pruebas-suficientemente-larga' : undefined),
    } as unknown as ConfigService);
    // The documents that carry drawn numbers answer for themselves, as they do in the application.
    const issued = new IssuedFiscalNumbersRegistry();
    new InvoiceIssuedFiscalNumbers(issued).onModuleInit();
    new PosIssuedFiscalNumbers(issued).onModuleInit();
    ranges = new FiscalRangeService(vault, issued);
    factory = new FiscalAdapterFactory(ranges, dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    organizationId = await createTestOrganization(dataSource, 'QA-Numeración');
    // A responsable inscripto, for the market whose class follows from the issuer's VAT condition.
    await dataSource.query(
      `UPDATE "organizations" SET "country" = 'CL', "timezone" = 'America/Santiago', "fiscal_profile" = $2 WHERE "id" = $1`,
      [organizationId, JSON.stringify({ condicionIva: '1' })],
    );

    const customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        organizationId,
        companyName: 'Comprador',
        email: `comprador-${Date.now()}@example.test`,
        taxId: '20123456786',
      } as unknown as Customer),
    );
    customerId = customer.id;
  });

  afterEach(async () => {
    await dataSource.query(`DELETE FROM "organizations" WHERE "id" = $1`, [organizationId]);
  });

  const register = (input: Omit<FiscalRangeRegistration, 'organizationId' | 'today'> & { today?: string }) =>
    dataSource.transaction((manager) => ranges.register(manager, { organizationId, today: TODAY, ...input }));

  /** An invoice good enough to be numbered. Nothing here is posted; numbering is upstream of that. */
  const invoiceFor = (overrides: Partial<Invoice> = {}): Invoice =>
    ({
      id: '00000000-0000-0000-0000-000000000000',
      organizationId,
      customerId,
      // Denormalised onto the document at issuance, exactly as `issueWithin` leaves it.
      customerTaxId: '76086428-5',
      type: InvoiceType.INVOICE,
      issueDate: TODAY,
      currencyCode: 'CLP',
      subtotal: 100_000,
      tax: 19_000,
      total: 119_000,
      branchId: null,
      ...overrides,
    }) as unknown as Invoice;

  const contextFor = (manager: EntityManager, overrides: Partial<Invoice> = {}, requestedType?: string): FiscalAssignmentContext => ({
    invoice: invoiceFor(overrides),
    organizationId,
    manager,
    requestedType: requestedType ?? null,
  });

  const market = (code: string): FiscalAdapter => factory.forCountry(code);
  const issue = (code: string, overrides: Partial<Invoice> = {}, requestedType?: string) =>
    dataSource.transaction((manager) => market(code).assignSalesNumber(contextFor(manager, overrides, requestedType)));

  /** The active range of a type, locked in the caller's transaction; a test expecting none fails here. */
  const lockedRange = async (manager: EntityManager, countryCode: string, documentType: string) => {
    const range = await ranges.lockActive(manager, { organizationId, countryCode, documentType, series: '' });
    if (!range) throw new Error(`no active ${countryCode}/${documentType} range`);
    return range;
  };

  const settingsFor = (partial: Partial<FiscalRegimeSettings>) =>
    dataSource.getRepository(FiscalRegimeSettings).save(
      dataSource.getRepository(FiscalRegimeSettings).create({ organizationId, environment: FiscalEnvironment.CERTIFICATION, ...partial }),
    );

  describe('Chile — SII', () => {
    it('draws the folio from the CAF authorised for the type the sale is, and records it', async () => {
      await register({ countryCode: 'CL', documentType: '33', startsAt: 500, endsAt: 599, authorizationCode: 'CAF-2026-33' });

      const assignment = await issue('CL');

      // A bare folio: the SII writes no prefix and no padding.
      expect(assignment).toMatchObject({ fiscalNumber: '500', documentType: '33', sequence: 500, series: '' });
    });

    it('refuses an afecta folio for an exempt sale, rather than quietly issuing the exenta one', async () => {
      await register({ countryCode: 'CL', documentType: '34', startsAt: 1, endsAt: 100 });
      await expect(issue('CL', { tax: 0, total: 100_000 }, '33')).rejects.toMatchObject({
        messageKey: 'invoices.you_asked_type_requested_document_type',
      });
    });

    it('keeps the CAF key encrypted at rest and hands it back only when asked for', async () => {
      const cafXml = '<AUTORIZACION><CAF><RSASK>clave-privada-del-caf</RSASK></CAF></AUTORIZACION>';
      await register({ countryCode: 'CL', documentType: '33', startsAt: 1, endsAt: 10, secret: cafXml, secretKind: FiscalRangeSecretKind.CAF_XML });

      const stored = await dataSource.getRepository(FiscalDocumentRange).findOneByOrFail({ organizationId, countryCode: 'CL', documentType: '33', isActive: true });
      // A database dump with a CAF in the clear lets whoever reads it stamp documents in the taxpayer's name.
      expect(stored.encryptedSecret).toBeTruthy();
      expect(stored.encryptedSecret).not.toContain('clave-privada-del-caf');
      expect(vault.decrypt(stored.encryptedSecret as string).toString('utf8')).toBe(cafXml);

      const drawn = await dataSource.transaction((manager) =>
        ranges.drawNext(manager, { organizationId, countryCode: 'CL', documentType: '33', today: TODAY, withSecret: true }),
      );
      expect(drawn.secret).toBe(cafXml);
      expect(drawn.secretKind).toBe(FiscalRangeSecretKind.CAF_XML);
    });
  });

  describe('Peru — SUNAT', () => {
    it('writes the number as SUNAT reads it, and records the series it was drawn from', async () => {
      await register({ countryCode: 'PE', documentType: '01', series: 'F001', startsAt: 123, endsAt: 999 });
      const assignment = await issue('PE', { currencyCode: 'PEN', customerTaxId: '20123456786' });
      expect(assignment).toMatchObject({ fiscalNumber: 'F001-00000123', documentType: '01', sequence: 123, series: 'F001' });
    });

    it('issues a boleta when the buyer holds no RUC, and honours an explicit boleta for one who does', async () => {
      await register({ countryCode: 'PE', documentType: '03', series: 'B001', startsAt: 1, endsAt: 999 });

      const inferred = await issue('PE', { currencyCode: 'PEN', customerTaxId: null });
      expect(inferred).toMatchObject({ documentType: '03', fiscalNumber: 'B001-00000001' });
      // SUNAT permits a boleta to a buyer with a RUC, so an explicit request is honoured.
      const requested = await issue('PE', { currencyCode: 'PEN', customerTaxId: '20123456786' }, '03');
      expect(requested.documentType).toBe('03');
    });

    it('refuses a range whose series letter contradicts its type, for every document it would number', async () => {
      await expect(register({ countryCode: 'PE', documentType: '03', series: 'F002', startsAt: 1, endsAt: 10 })).rejects.toMatchObject({
        messageKey: 'einvoicing.series_series_does_not_match_document',
      });
    });

    it("draws a note from a series of its document's letter, even when another is in force", async () => {
      await register({ countryCode: 'PE', documentType: '07', series: 'FC01', startsAt: 1, endsAt: 100 });
      await register({ countryCode: 'PE', documentType: '07', series: 'BC01', startsAt: 1, endsAt: 100 });

      const note = await dataSource.transaction((manager) =>
        market('PE').assignCreditNoteNumber({
          ...contextFor(manager, { type: InvoiceType.CREDIT_NOTE, currencyCode: 'PEN', customerTaxId: null }),
          originalInvoice: { fiscalDocumentType: '03', fiscalNumber: 'B001-00000004' } as Invoice,
        }),
      );
      expect(note).toMatchObject({ documentType: '07', series: 'BC01', fiscalNumber: 'BC01-00000001' });
    });
  });

  describe('Ecuador — SRI', () => {
    it("composes establishment, emission point and a nine-digit sequential, from that point's range", async () => {
      await settingsFor({ countryCode: 'EC', establishment: '001', emissionPoint: '002' });
      await register({ countryCode: 'EC', documentType: '01', series: '001-002', startsAt: 45, endsAt: 1_000 });

      const assignment = await issue('EC', { currencyCode: 'USD' });
      expect(assignment).toMatchObject({ fiscalNumber: '001-002-000000045', sequence: 45, series: '001-002' });
    });

    it("numbers a branch's invoice under its own establishment, from its own emission point's range", async () => {
      await settingsFor({ countryCode: 'EC', establishment: '001', emissionPoint: '001' });
      const [branch] = await dataSource.query(
        `INSERT INTO "branches" ("organization_id", "code", "name", "fiscal_establishment_code", "emission_point_code")
         VALUES ($1, 'GYE', 'Guayaquil', '2', '3') RETURNING "id"`,
        [organizationId],
      );
      await register({ countryCode: 'EC', documentType: '01', series: '001-001', startsAt: 500, endsAt: 1_000 });
      await register({ countryCode: 'EC', documentType: '01', series: '002-003', startsAt: 7, endsAt: 1_000 });

      const assignment = await issue('EC', { currencyCode: 'USD', branchId: branch.id } as Partial<Invoice>);
      expect(assignment.fiscalNumber).toBe('002-003-000000007');
    });

    it('refuses to number at all when the emission point is not configured', async () => {
      await register({ countryCode: 'EC', documentType: '01', series: '001-001', startsAt: 1, endsAt: 10 });
      await expect(issue('EC', { currencyCode: 'USD' })).rejects.toMatchObject({ messageKey: 'invoices.issuing_point_missing' });
    });

    it('refuses a range registered without the emission point it belongs to', async () => {
      await expect(register({ countryCode: 'EC', documentType: '01', startsAt: 1, endsAt: 10 })).rejects.toMatchObject({
        messageKey: 'einvoicing.series_series_does_not_match_document',
      });
    });
  });

  describe('Colombia — DIAN, Brazil — SEFAZ', () => {
    it('prefixes the consecutive with the resolution prefix, and the expiry travels with the number', async () => {
      await register({ countryCode: 'CO', documentType: '01', series: 'FE2', startsAt: 1_000, endsAt: 2_000, authorizationCode: '18760000001', validUntil: '2027-12-31' });
      const assignment = await issue('CO', { currencyCode: 'COP' });
      // A prefix carrying a digit is exactly what reading the consecutive back out of the number got wrong.
      expect(assignment).toMatchObject({ fiscalNumber: 'FE21000', sequence: 1_000, series: 'FE2', expiresAt: '2027-12-31' });
    });

    it('numbers within the série and writes the nNF bare', async () => {
      await register({ countryCode: 'BR', documentType: '55', series: '1', startsAt: 7, endsAt: 999_999 });
      // An NF-e names its buyer by CPF or CNPJ.
      const assignment = await issue('BR', { currencyCode: 'BRL', customerTaxId: '11222333000181' });
      expect(assignment).toMatchObject({ fiscalNumber: '7', documentType: '55', sequence: 7, series: '1' });
    });
  });

  describe('the markets whose authority assigns the identity', () => {
    it('Mexico records the comprobante type and no number, because the PAC assigns the UUID', async () => {
      expect(await issue('MX', { currencyCode: 'MXN' })).toEqual({ fiscalNumber: null, documentType: 'I', expiresAt: null, sequence: null, series: null });
    });

    it('Argentina records the class AFIP will number, from the issuer and the buyer, and no number', async () => {
      expect(await issue('AR', { currencyCode: 'ARS' })).toMatchObject({ fiscalNumber: null, documentType: '6', sequence: null });
    });

    it('a range is refused where the market does not number from one: it would never be drawn', async () => {
      for (const countryCode of ['MX', 'AR', 'US']) {
        await expect(register({ countryCode, documentType: 'I', startsAt: 1, endsAt: 10 })).rejects.toMatchObject({
          messageKey: 'einvoicing.market_does_not_number_from_ranges',
        });
      }
    });
  });

  describe('Dominican Republic — DGII', () => {
    it('draws the comprobante the buyer qualifies for, written by the catalogue mask, and the till receipt', async () => {
      await register({ countryCode: 'DO', documentType: 'E32', startsAt: 1, endsAt: 100, validUntil: '2027-12-31' });
      await register({ countryCode: 'DO', documentType: 'B02', startsAt: 1, endsAt: 100, validUntil: '2027-12-31' });

      const consumo = await issue('DO', { currencyCode: 'DOP', customerTaxId: null });
      expect(consumo).toMatchObject({ fiscalNumber: 'E320000000001', documentType: 'E32', expiresAt: '2027-12-31', sequence: 1, series: '' });

      const tillReceipt = market('DO').assignTillReceiptNumber;
      if (!tillReceipt) throw new Error('the Dominican market hands consumers a receipt from the till');
      const receipt = await dataSource.transaction((manager) => tillReceipt({ organizationId, today: TODAY, manager }));
      expect(receipt).toMatchObject({ fiscalNumber: 'B0200000001', documentType: 'B02', sequence: 1 });
    });

    it('refuses an NCF range without the expiry the DGII states, or with a series it does not have', async () => {
      await expect(register({ countryCode: 'DO', documentType: 'B01', startsAt: 1, endsAt: 100 })).rejects.toMatchObject({
        messageKey: 'einvoicing.range_expiry_date_required',
      });
      await expect(register({ countryCode: 'DO', documentType: 'B01', series: 'A', startsAt: 1, endsAt: 100, validUntil: '2027-12-31' })).rejects.toMatchObject({
        messageKey: 'einvoicing.series_series_does_not_match_document',
      });
      await expect(register({ countryCode: 'DO', documentType: 'B01', startsAt: 1, endsAt: 100, validUntil: '2026-11-08' })).rejects.toMatchObject({
        messageKey: 'einvoicing.range_authorization_already_expired',
      });
    });

    it('closes a declared stretch from the next unissued number, never one already issued, and skips none', async () => {
      await register({ countryCode: 'DO', documentType: 'E31', startsAt: 1, endsAt: 100, validUntil: '2027-12-31' });
      await issue('DO', { currencyCode: 'DOP', customerTaxId: '130456781' }); // E310000000001 is issued.

      await dataSource.transaction(async (manager) => {
        const range = await lockedRange(manager, 'DO', 'E31');
        expect(() => ranges.assertClosableStretch(range, 1, 10)).toThrow(expect.objectContaining({ messageKey: 'einvoicing.range_stretch_already_issued' }));
        expect(() => ranges.assertClosableStretch(range, 3, 10)).toThrow(expect.objectContaining({ messageKey: 'einvoicing.range_stretch_must_start_at_next' }));
        expect(() => ranges.assertClosableStretch(range, 2, 101)).toThrow(expect.objectContaining({ messageKey: 'einvoicing.range_stretch_beyond_end' }));
        ranges.assertClosableStretch(range, 2, 10);
        await ranges.closeThrough(manager, range, 10);
      });

      // The numbers declared void are never drawn, and the first one after them is not skipped.
      expect((await issue('DO', { currencyCode: 'DOP', customerTaxId: '130456781' })).fiscalNumber).toBe('E310000000011');

      await dataSource.transaction(async (manager) => {
        const range = await lockedRange(manager, 'DO', 'E31');
        await ranges.closeThrough(manager, range, 100);
      });
      // A range closed to its last number is retired.
      expect(await dataSource.getRepository(FiscalDocumentRange).countBy({ organizationId, countryCode: 'DO', documentType: 'E31', isActive: true })).toBe(0);
    });
  });

  describe('the invariants a fiscal number lives or dies by', () => {
    it('never hands the same number to two concurrent issuances', async () => {
      await register({ countryCode: 'CL', documentType: '33', startsAt: 1, endsAt: 100 });
      // Without `FOR UPDATE` both read `current_sequence` as 0 and both return folio 1.
      const [first, second] = await Promise.all([issue('CL'), issue('CL')]);
      expect([first.fiscalNumber, second.fiscalNumber].sort()).toEqual(['1', '2']);
    });

    it('refuses once the range is exhausted, instead of numbering past its upper bound', async () => {
      await register({ countryCode: 'CL', documentType: '33', startsAt: 1, endsAt: 2 });
      expect((await issue('CL')).fiscalNumber).toBe('1');
      expect((await issue('CL')).fiscalNumber).toBe('2');
      await expect(issue('CL')).rejects.toMatchObject({ messageKey: 'einvoicing.authorized_range_type_type_exhausted_range' });
    });

    it('refuses a range whose authorisation lapsed after it was registered, however many numbers are left', async () => {
      // Registered in force, then the date passed: written directly, as time would leave it.
      await dataSource.getRepository(FiscalDocumentRange).save({
        organizationId, countryCode: 'CO', documentType: '01', series: 'SETP', startsAt: 1, endsAt: 1_000_000, currentSequence: 0, isActive: true, validUntil: '2020-01-31',
      });
      await expect(issue('CO', { currencyCode: 'COP' })).rejects.toMatchObject({ messageKey: 'einvoicing.authorization_type_type_range_expired_date' });
    });

    it('refuses to issue at all when the tenant holds no range for the type', async () => {
      await expect(issue('CL')).rejects.toMatchObject({ messageKey: 'einvoicing.no_active_authorized_range_document_type' });
    });

    it('supersedes the previous range rather than deleting it, so past documents stay traceable', async () => {
      await register({ countryCode: 'CL', documentType: '33', startsAt: 1, endsAt: 10, authorizationCode: 'CAF-A' });
      await register({ countryCode: 'CL', documentType: '33', startsAt: 11, endsAt: 20, authorizationCode: 'CAF-B' });

      const all = await dataSource.getRepository(FiscalDocumentRange).find({ where: { organizationId, countryCode: 'CL', documentType: '33' }, order: { startsAt: 'ASC' } });
      expect(all.map((range) => [range.authorizationCode, range.isActive])).toEqual([['CAF-A', false], ['CAF-B', true]]);
      expect((await issue('CL')).fiscalNumber).toBe('11');
    });

    it('refuses a document type that belongs to another market', async () => {
      await register({ countryCode: 'CL', documentType: '33', startsAt: 1, endsAt: 10 });
      await expect(issue('CL', {}, 'E31')).rejects.toMatchObject({ messageKey: 'invoices.document_type_type_does_not_exist' });
      await expect(register({ countryCode: 'CL', documentType: '01', startsAt: 1, endsAt: 10 })).rejects.toMatchObject({
        messageKey: 'einvoicing.range_type_not_in_market_catalogue',
      });
    });
  });

  describe('registering a range: what used to be checked for one market only', () => {
    it('refuses a range overlapping one registered before, in force or retired', async () => {
      await register({ countryCode: 'CL', documentType: '33', startsAt: 1, endsAt: 100 });
      await expect(register({ countryCode: 'CL', documentType: '33', startsAt: 50, endsAt: 150 })).rejects.toMatchObject({ messageKey: 'einvoicing.range_overlaps_registered' });

      await register({ countryCode: 'CL', documentType: '33', startsAt: 101, endsAt: 200 }); // retires 1–100
      // Re-entering the retired range would hand its numbers out again.
      await expect(register({ countryCode: 'CL', documentType: '33', startsAt: 1, endsAt: 100 })).rejects.toMatchObject({ messageKey: 'einvoicing.range_overlaps_registered' });
      // Another series is another numbering.
      await expect(register({ countryCode: 'PE', documentType: '01', series: 'F001', startsAt: 1, endsAt: 100 })).resolves.toBeTruthy();
      await expect(register({ countryCode: 'PE', documentType: '01', series: 'F002', startsAt: 1, endsAt: 100 })).resolves.toBeTruthy();
    });

    it('refuses a range whose numbers are already on invoices or till receipts', async () => {
      await dataSource.query(
        `INSERT INTO "invoices" ("organization_id", "invoiceNumber", "customerName", "issueDate", "dueDate", "subtotal", "tax", "total",
                                 "total_in_base_currency", "version", "customer_id", "fiscal_number", "fiscal_document_type", "fiscal_sequence", "fiscal_series")
         VALUES ($1, 'QA-1', 'c', $2, $2, 1, 0, 1, 1, 1, $3, '777', '33', 777, '')`,
        [organizationId, TODAY, customerId],
      );
      await expect(register({ countryCode: 'CL', documentType: '33', startsAt: 700, endsAt: 800 })).rejects.toMatchObject({
        messageKey: 'einvoicing.range_numbers_already_issued',
        params: expect.objectContaining({ count: 1 }),
      });

      await dataSource.query(
        `INSERT INTO "pos_sales" ("organization_id", "terminalId", "fiscal_number", "fiscal_document_type", "fiscal_sequence", "fiscal_series")
         VALUES ($1, 'T1', 'B0200000005', 'B02', 5, '')`,
        [organizationId],
      );
      await expect(register({ countryCode: 'DO', documentType: 'B02', startsAt: 1, endsAt: 10, validUntil: '2027-12-31' })).rejects.toMatchObject({
        messageKey: 'einvoicing.range_numbers_already_issued',
      });
    });

    it('lets only one of two simultaneous submissions of the same range through', async () => {
      const results = await Promise.allSettled([
        register({ countryCode: 'CL', documentType: '33', startsAt: 1, endsAt: 100 }),
        register({ countryCode: 'CL', documentType: '33', startsAt: 1, endsAt: 100 }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(await dataSource.getRepository(FiscalDocumentRange).countBy({ organizationId, countryCode: 'CL', documentType: '33' })).toBe(1);
    });

    it('reactivates a superseded range by retiring the one in force, but never an exhausted one', async () => {
      const first = await register({ countryCode: 'CL', documentType: '33', startsAt: 1, endsAt: 10 });
      const second = await register({ countryCode: 'CL', documentType: '33', startsAt: 11, endsAt: 20 });

      await dataSource.transaction((manager) => ranges.setActive(manager, { organizationId, countryCode: 'CL', rangeId: first.id, isActive: true, today: TODAY }));
      const rows = await dataSource.getRepository(FiscalDocumentRange).find({ where: { organizationId, countryCode: 'CL' }, order: { startsAt: 'ASC' } });
      expect(rows.map((row) => row.isActive)).toEqual([true, false]);

      await dataSource.getRepository(FiscalDocumentRange).update({ id: second.id }, { currentSequence: 20 });
      await expect(
        dataSource.transaction((manager) => ranges.setActive(manager, { organizationId, countryCode: 'CL', rangeId: second.id, isActive: true, today: TODAY })),
      ).rejects.toMatchObject({ messageKey: 'einvoicing.range_exhausted_cannot_reactivate' });
    });
  });
});
