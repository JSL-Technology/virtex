import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestOrganization, describeWithDb, openTestDataSource } from '../../../common/database/testing/integration-db';
import { IssuedFiscalNumbersRegistry } from '../../../contracts/fiscal-records/issued-fiscal-numbers.registry';
import { InvoiceIssuedFiscalNumbers } from '../../../invoices/issued-fiscal-numbers.source';
import { FiscalDocumentEvent, FiscalDocumentEventKind } from '../../entities/fiscal-document-event.entity';
import { FiscalSubmissionStatus } from '../../entities/fiscal-submission.entity';
import { FiscalDocumentRange } from '../../entities/fiscal-document-range.entity';
import { CertificateVaultService } from '../../services/certificate-vault.service';
import { DgiiAuthService } from '../../services/dgii-auth.service';
import { DgiiReceptionResult, DgiiTransportService } from '../../services/dgii-transport.service';
import { DgiiEventXmlBuilder } from './dgii-event-xml.builder';
import { DgiiDocumentEventsService } from './dgii-document-events.service';
import { EcfSignerService } from '../../services/ecf-signer.service';
import { FiscalRangeService } from '../../services/fiscal-range.service';

/**
 * Declaring to the DGII the numbers of a range that will never be used, against a real PostgreSQL.
 *
 * Nothing tested this, and it was wrong in the way that matters most: the stretch was checked
 * against the number LAST issued as if it were the next one, so the DGII was told that an e-NCF
 * already on a customer's invoice did not exist — and the cursor then skipped one number nobody
 * declared. What is pinned here is what an annulment must never do: name an issued number, leave a
 * declared one drawable, close numbers the DGII did not take, or let an invoice be numbered from
 * the stretch while the DGII is being asked.
 *
 * The exchange with the DGII is a test double — nothing leaves this process. The ranges, their
 * lock and the message rows are the real ones.
 */
describeWithDb('declaring unused numbers void (ANECF)', () => {
  jest.setTimeout(120_000);

  const TODAY = '2026-11-09';
  const ACCEPTED: DgiiReceptionResult = { trackId: 'trk-1', estado: 'Aceptado', mensajes: [], raw: { estado: 'Aceptado' } };
  const REJECTED: DgiiReceptionResult = { trackId: 'trk-2', estado: 'Rechazado', mensajes: ['Secuencia inválida'], raw: {} };

  let dataSource: DataSource;
  let ranges: FiscalRangeService;
  let service: DgiiDocumentEventsService;
  let organizationId: string;
  const voidAtDgii = jest.fn<Promise<DgiiReceptionResult>, [string, string, string]>();

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    const issued = new IssuedFiscalNumbersRegistry();
    new InvoiceIssuedFiscalNumbers(issued).onModuleInit();
    // No range here carries a secret, so the vault is never asked for anything.
    ranges = new FiscalRangeService({} as CertificateVaultService, issued);
    service = new DgiiDocumentEventsService(
      dataSource.getRepository(FiscalDocumentEvent),
      // An active certificate of the DGII's regime: what it holds is the signer's business.
      { findOne: async () => ({ notAfter: new Date(Date.now() + 86_400_000) }) } as never,
      // By entity name: the class belongs to another module (verify:boundaries).
      dataSource.getRepository('Organization') as never,
      { load: () => ({ privateKeyPem: '', certificatePem: '' }) } as unknown as CertificateVaultService,
      // Signing is exercised where it belongs; here the message travels as built.
      { sign: (xml: string) => xml } as unknown as EcfSignerService,
      new DgiiEventXmlBuilder(),
      { getToken: async () => 'token' } as unknown as DgiiAuthService,
      { voidSequenceRange: voidAtDgii } as unknown as DgiiTransportService,
      ranges,
      dataSource,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    voidAtDgii.mockReset();
    organizationId = await createTestOrganization(dataSource, 'QA-ANECF');
    await dataSource.query(`UPDATE "organizations" SET "country" = 'DO', "tax_id" = $2 WHERE "id" = $1`, [
      organizationId,
      `1${String(Date.now()).slice(-8)}`,
    ]);
    // E31 1–100 in force, with number 1 already on a document.
    await dataSource.transaction((manager) =>
      ranges.register(manager, { organizationId, countryCode: 'DO', documentType: 'E31', startsAt: 1, endsAt: 100, validUntil: '2027-12-31', today: TODAY }),
    );
    await draw();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await dataSource.query(`DELETE FROM "organizations" WHERE "id" = $1`, [organizationId]);
  });

  const draw = (documentType = 'E31') =>
    dataSource.transaction((manager) => ranges.drawNext(manager, { organizationId, countryCode: 'DO', documentType, today: TODAY }));
  const cursor = async () =>
    Number((await dataSource.getRepository(FiscalDocumentRange).findOneByOrFail({ organizationId, countryCode: 'DO', documentType: 'E31' })).currentSequence);
  const messages = () =>
    dataSource.getRepository(FiscalDocumentEvent).find({ where: { organizationId, kind: FiscalDocumentEventKind.NUMBER_RANGE_VOID }, order: { createdAt: 'ASC' } });

  it('declares exactly the stretch asked for, as the DGII writes it, and closes it once the DGII takes it', async () => {
    voidAtDgii.mockResolvedValue(ACCEPTED);

    const message = await service.voidRange(organizationId, { type: 'e31', from: 2, to: 10 });

    expect(message).toMatchObject({ status: FiscalSubmissionStatus.ACCEPTED, documentType: 'E31', sequenceFrom: '2', sequenceTo: '10', trackingId: 'trk-1' });
    const xml = voidAtDgii.mock.calls[0][2];
    // The issued number (1) is not in the declaration, and nine numbers are: 2 through 10.
    expect(xml).toContain('<SecuenciaeNCFDesde>E310000000002</SecuenciaeNCFDesde>');
    expect(xml).toContain('<SecuenciaeNCFHasta>E310000000010</SecuenciaeNCFHasta>');
    expect(xml).toContain('<TipoeCF>31</TipoeCF>');
    expect(xml).toContain('<CantidadeNCFAnulados>9</CantidadeNCFAnulados>');
    // The declared numbers are never drawn, and the first one after them is not skipped.
    expect((await draw()).number).toBe(11);
  });

  it('refuses a stretch that names an issued number or leaves a gap, before anything is built', async () => {
    await expect(service.voidRange(organizationId, { type: 'E31', from: 1, to: 10 })).rejects.toMatchObject({
      messageKey: 'einvoicing.range_stretch_already_issued',
    });
    await expect(service.voidRange(organizationId, { type: 'E31', from: 5, to: 10 })).rejects.toMatchObject({
      messageKey: 'einvoicing.range_stretch_must_start_at_next',
    });
    await expect(service.voidRange(organizationId, { type: 'E31', from: 2, to: 101 })).rejects.toMatchObject({
      messageKey: 'einvoicing.range_stretch_beyond_end',
    });

    expect(voidAtDgii).not.toHaveBeenCalled();
    expect(await messages()).toHaveLength(0);
    expect(await cursor()).toBe(1);
  });

  it('leaves the numbers as they were when the DGII refuses the declaration', async () => {
    voidAtDgii.mockResolvedValue(REJECTED);

    const message = await service.voidRange(organizationId, { type: 'E31', from: 2, to: 10 });

    expect(message.status).toBe(FiscalSubmissionStatus.REJECTED);
    expect(await cursor()).toBe(1);
    expect((await draw()).number).toBe(2);
  });

  it('leaves the numbers as they were when the DGII cannot be reached, and says it can be retried', async () => {
    voidAtDgii.mockRejectedValue(new ServiceUnavailableException('DGII no disponible'));

    const message = await service.voidRange(organizationId, { type: 'E31', from: 2, to: 10 });

    // An outage is retriable; a refusal is not.
    expect(message.status).toBe(FiscalSubmissionStatus.CONTINGENCY);
    expect(await cursor()).toBe(1);
  });

  it('does not record a taken declaration as failed when closing it here fails, and resumes without declaring twice', async () => {
    voidAtDgii.mockResolvedValue(ACCEPTED);
    jest.spyOn(ranges, 'closeThrough').mockRejectedValueOnce(new Error('connection lost'));

    await expect(service.voidRange(organizationId, { type: 'E31', from: 2, to: 10 })).rejects.toThrow('connection lost');
    // The DGII took it: that is what the record says, whatever happened here afterwards.
    expect((await messages()).map((message) => message.status)).toEqual([FiscalSubmissionStatus.ACCEPTED]);
    expect(await cursor()).toBe(1);

    const resumed = await service.voidRange(organizationId, { type: 'E31', from: 2, to: 10 });

    expect(resumed.status).toBe(FiscalSubmissionStatus.ACCEPTED);
    // Closed now, with no second declaration and no second record.
    expect(voidAtDgii).toHaveBeenCalledTimes(1);
    expect(await messages()).toHaveLength(1);
    expect((await draw()).number).toBe(11);
  });

  it('keeps every invoice of the type waiting while the DGII is asked, so none is numbered from the stretch', async () => {
    let answer: (result: DgiiReceptionResult) => void = () => undefined;
    let asked: () => void = () => undefined;
    const dgiiAsked = new Promise<void>((resolve) => (asked = resolve));
    voidAtDgii.mockImplementation(
      () =>
        new Promise<DgiiReceptionResult>((resolve) => {
          answer = resolve;
          asked();
        }),
    );

    const voiding = service.voidRange(organizationId, { type: 'E31', from: 2, to: 10 });
    await dgiiAsked;
    const drawing = draw();
    const state = await Promise.race([
      drawing.then(() => 'numbered'),
      new Promise<string>((resolve) => setTimeout(() => resolve('waiting'), 400)),
    ]);
    // Without the lock held across the exchange this invoice takes number 2 — one the DGII is
    // being told, at this very moment, will never exist.
    expect(state).toBe('waiting');

    answer(ACCEPTED);
    await voiding;
    expect((await drawing).number).toBe(11);
  });

  it('retires a range whose last numbers were declared void', async () => {
    voidAtDgii.mockResolvedValue(ACCEPTED);
    await service.voidRange(organizationId, { type: 'E31', from: 2, to: 100 });

    expect(await dataSource.getRepository(FiscalDocumentRange).countBy({ organizationId, documentType: 'E31', isActive: true })).toBe(0);
    await expect(draw()).rejects.toMatchObject({ messageKey: 'einvoicing.no_active_authorized_range_document_type' });
  });

  it('declares nothing for a traditional type: its range is simply retired', async () => {
    await dataSource.transaction((manager) =>
      ranges.register(manager, { organizationId, countryCode: 'DO', documentType: 'B01', startsAt: 1, endsAt: 100, validUntil: '2027-12-31', today: TODAY }),
    );
    await expect(service.voidRange(organizationId, { type: 'B01', from: 1, to: 10 })).rejects.toMatchObject({
      messageKey: 'einvoicing.do.type_not_electronic_type_voiding_ranges',
    });
    expect(voidAtDgii).not.toHaveBeenCalled();
  });

  it("refuses a company of another market: the message is the DGII regime's, and nothing is built in its name", async () => {
    await dataSource.query(`UPDATE "organizations" SET "country" = 'CL' WHERE "id" = $1`, [organizationId]);
    await dataSource.transaction((manager) =>
      ranges.register(manager, { organizationId, countryCode: 'CL', documentType: '33', startsAt: 1, endsAt: 100, today: TODAY }),
    );

    await expect(service.voidRange(organizationId, { type: '33', from: 1, to: 10 })).rejects.toMatchObject({
      messageKey: 'einvoicing.do.message_belongs_to_dgii_regime',
    });
    expect(voidAtDgii).not.toHaveBeenCalled();
    expect(await messages()).toHaveLength(0);
  });
});
