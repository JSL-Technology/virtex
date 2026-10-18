// The invoice renderer loads puppeteer at import; nothing here renders a page.
jest.mock('puppeteer', () => ({}));

import { DataSource } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { PaymentLikelihoodRegistry } from '../contracts/ai/payment-likelihood.contract';
import { CollectionsService } from './collections.service';
import { CollectionActivity } from './entities/collection-activity.entity';

/**
 * Collections against a real database: the worklist ranks what the person may see, a promise
 * changes the ranking the way the rules say, a reminder is drafted once per invoice and sent from
 * the draft, and nothing reaches another tenant's invoices.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

const isoDaysFromToday = (days: number) => {
  // The service reads "today" in the company's time zone; Santo Domingo is UTC−4 all year.
  const now = new Date(Date.now() - 4 * 3_600_000);
  now.setUTCDate(now.getUTCDate() + days);
  return now.toISOString().slice(0, 10);
};

describeWithDb('collections', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let service: CollectionsService;
  let likelihood: PaymentLikelihoodRegistry;
  const mail = { sendPaymentReminder: jest.fn().mockResolvedValue(undefined) };
  const ai = { available: jest.fn().mockReturnValue(true), compose: jest.fn(), extract: jest.fn() };
  const renderer = {
    emailSummary: jest.fn().mockReturnValue({ language: 'es', total: 'USD 1,000.00', balance: 'USD 600.00', dueDate: '1 de octubre de 2026' }),
    renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
  };
  const invoices = {
    renderContext: jest.fn(async (id: string) => ({
      invoice: { id },
      context: { organization: { legalName: 'Caribe Logística SRL' } },
    })),
    senderIdentity: jest.fn().mockResolvedValue({ senderName: 'Caribe Logística', replyTo: 'cobros@caribe.test', copyTo: null }),
  };

  let organizationId: string;
  let otherOrganizationId: string;
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
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  const organization = async () =>
    (
      await dataSource.getRepository(Organization).save(
        dataSource.getRepository(Organization).create({
          legalName: `COB ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timezone: 'America/Santo_Domingo',
        }),
      )
    ).id;

  const customer = async (orgId: string, name = 'Distribuidora Nacional') =>
    (
      await dataSource.getRepository(Customer).save(
        dataSource.getRepository(Customer).create({
          organizationId: orgId,
          companyName: name,
          email: `cliente-${Math.random().toString(36).slice(2, 8)}@ejemplo.do`,
        }),
      )
    ).id;

  const invoice = (orgId: string, custId: string, balance: number, dueInDays: number, status = InvoiceStatus.PENDING) =>
    dataSource.getRepository(Invoice).save(
      dataSource.getRepository(Invoice).create({
        organizationId: orgId,
        customerId: custId,
        customerName: 'Distribuidora Nacional',
        invoiceNumber: `F-${Math.random().toString(36).slice(2, 8)}`,
        issueDate: isoDaysFromToday(dueInDays - 30),
        dueDate: isoDaysFromToday(dueInDays),
        status,
        currencyCode: 'USD',
        exchangeRate: 1,
        subtotal: 1000,
        tax: 0,
        total: 1000,
        netReceivable: 1000,
        balance,
        totalInBaseCurrency: 1000,
      } as never) as unknown as Invoice,
    );

  beforeEach(async () => {
    jest.clearAllMocks();
    likelihood = new PaymentLikelihoodRegistry();
    service = new CollectionsService(
      dataSource,
      dataSource.getRepository(CollectionActivity),
      invoices as never,
      renderer as never,
      mail as never,
      likelihood,
      ai as never,
    );
    organizationId = await organization();
    otherOrganizationId = await organization();
    customerId = await customer(organizationId);
  });

  describe('the worklist', () => {
    it('lists only open invoices of this company, the most pressing first', async () => {
      const old = await invoice(organizationId, customerId, 600, -75);
      const recent = await invoice(organizationId, customerId, 600, -5);
      await invoice(organizationId, customerId, 0, -40, InvoiceStatus.PAID);
      await invoice(otherOrganizationId, await customer(otherOrganizationId), 9_000, -90);

      const list = await service.worklist(organizationId, null);

      expect(list.items.map((item) => item.invoiceId)).toEqual([old.id, recent.id]);
      expect(list.items[0]).toMatchObject({ action: 'call', likelihoodSource: 'age', daysOverdue: 75 });
      expect(list.items[1]).toMatchObject({ action: 'reminder', suggestedTone: 'formal' });
      expect(list.totals.invoices).toBe(2);
      expect(list.projectionAt).toBeNull();
    });

    it('ranks by the projection when there is one', async () => {
      const willPay = await invoice(organizationId, customerId, 600, -20);
      const wontPay = await invoice(organizationId, customerId, 600, -20);
      likelihood.provide({
        forInvoices: async () => ({
          computedAt: new Date(),
          byInvoice: new Map([
            [willPay.id, { invoiceId: willPay.id, pBy7: 0.8, pBy30: 0.95, expectedDate: isoDaysFromToday(3), doubtful: false }],
            [wontPay.id, { invoiceId: wontPay.id, pBy7: 0.05, pBy30: 0.1, expectedDate: null, doubtful: true }],
          ]),
        }),
      });

      const list = await service.worklist(organizationId, null);

      expect(list.items[0].invoiceId).toBe(wontPay.id);
      expect(list.items[0]).toMatchObject({ likelihoodSource: 'projection', doubtful: true, pBy30: 0.1 });
      expect(list.items[0].reasons).toEqual(expect.arrayContaining(['unlikely_soon', 'doubtful']));
    });

    it('waits on a promise in date, and moves a broken one up with a call', async () => {
      const promised = await invoice(organizationId, customerId, 600, -10);
      const broken = await invoice(organizationId, customerId, 600, -10);
      await service.log(organizationId, '44444444-4444-4444-8444-444444444444', {
        invoiceId: promised.id,
        kind: 'PROMISE',
        promisedDate: isoDaysFromToday(5),
      });
      // A promise made earlier whose date has passed: written directly, as the past would have.
      await dataSource.getRepository(CollectionActivity).save({
        organizationId,
        customerId,
        invoiceId: broken.id,
        kind: 'PROMISE',
        status: 'DONE',
        occurredAt: new Date(Date.now() - 10 * 86_400_000),
        promisedDate: isoDaysFromToday(-5),
      });

      const list = await service.worklist(organizationId, null);
      const byId = new Map(list.items.map((item) => [item.invoiceId, item]));

      expect(byId.get(promised.id)).toMatchObject({ action: 'await_promise', openPromise: { date: isoDaysFromToday(5) } });
      expect(byId.get(broken.id)).toMatchObject({ action: 'call', brokenPromises: 1 });
      expect(list.items[0].invoiceId).toBe(broken.id);
    });
  });

  describe('recording what was done', () => {
    it('records the promise a call ended in as well as the call', async () => {
      const open = await invoice(organizationId, customerId, 600, -10);
      const rows = await service.log(organizationId, '44444444-4444-4444-8444-444444444444', {
        invoiceId: open.id,
        kind: 'CALL',
        promisedDate: isoDaysFromToday(3),
        promisedAmount: 600,
      });

      expect(rows.map((row) => row.kind)).toEqual(['CALL', 'PROMISE']);
      expect(rows[0]).toMatchObject({ outcome: 'promised', channel: 'phone' });
      expect(rows[1]).toMatchObject({ promisedDate: isoDaysFromToday(3), promisedAmount: 600 });
    });

    it('refuses a promise in the past, or for more than is owed', async () => {
      const open = await invoice(organizationId, customerId, 600, -10);
      await expect(
        service.log(organizationId, '44444444-4444-4444-8444-444444444444', { invoiceId: open.id, kind: 'PROMISE', promisedDate: isoDaysFromToday(-1) }),
      ).rejects.toMatchObject({ messageKey: 'collections.promise_in_the_past' });
      await expect(
        service.log(organizationId, '44444444-4444-4444-8444-444444444444', {
          invoiceId: open.id,
          kind: 'PROMISE',
          promisedDate: isoDaysFromToday(2),
          promisedAmount: 601,
        }),
      ).rejects.toMatchObject({ messageKey: 'collections.promise_exceeds_balance' });
    });

    it('does not reach another company’s invoice, or one already paid', async () => {
      const foreign = await invoice(otherOrganizationId, await customer(otherOrganizationId), 600, -10);
      const paid = await invoice(organizationId, customerId, 0, -10, InvoiceStatus.PAID);
      await expect(service.log(organizationId, null as never, { invoiceId: foreign.id, kind: 'NOTE', message: 'x' })).rejects.toMatchObject({
        messageKey: 'collections.invoice_not_found',
      });
      await expect(service.log(organizationId, null as never, { invoiceId: paid.id, kind: 'NOTE', message: 'x' })).rejects.toMatchObject({
        messageKey: 'collections.invoice_not_open',
      });
    });
  });

  describe('reminders', () => {
    it('keeps one draft per invoice, and sending it completes that draft', async () => {
      const open = await invoice(organizationId, customerId, 600, -10);
      const first = await service.saveDraft(organizationId, null, open.id, { tone: 'cordial', message: 'Primera versión' });
      const second = await service.saveDraft(organizationId, null, open.id, { tone: 'firm', message: 'Le recordamos el saldo.' });

      const repo = dataSource.getRepository(CollectionActivity);
      expect((await repo.findOneByOrFail({ id: first.id })).status).toBe('CANCELLED');
      expect((await service.worklist(organizationId, null)).items[0].draftReminderId).toBe(second.id);

      const sent = await service.sendReminder(organizationId, { id: null, email: 'ana@caribe.test' }, open.id, { draftId: second.id });

      expect(sent.activityId).toBe(second.id);
      expect((await repo.findOneByOrFail({ id: second.id })).status).toBe('DONE');
      expect(mail.sendPaymentReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Le recordamos el saldo.',
          balance: 'USD 600.00',
          overdue: true,
          language: 'es',
          companyName: 'Caribe Logística SRL',
          pdf: expect.any(Buffer),
          identity: expect.objectContaining({ replyTo: 'cobros@caribe.test' }),
        }),
      );
      // Sent counts as a contact: tomorrow's worklist does not chase it again.
      expect((await service.worklist(organizationId, null)).items[0].action).toBe('wait');
    });

    it('sends without the attachment when the PDF cannot be rendered', async () => {
      const open = await invoice(organizationId, customerId, 600, -10);
      renderer.renderPdf.mockRejectedValueOnce(new Error('chromium down'));
      await service.sendReminder(organizationId, { id: null }, open.id, { message: null });
      expect(mail.sendPaymentReminder).toHaveBeenCalledWith(expect.objectContaining({ pdf: null }));
    });

    it('writes the note from the invoice’s own figures, and refuses when the assistant is off', async () => {
      const open = await invoice(organizationId, customerId, 600, -10);
      ai.compose.mockResolvedValueOnce({ value: { subject: '', body: 'La factura tiene un saldo de USD 600.00.' }, requestId: 'r', model: 'm' });

      const { message } = await service.composeReminder(organizationId, { id: null, firstName: 'Ana' }, open.id, 'firm');

      expect(message).toContain('USD 600.00');
      const request = ai.compose.mock.calls[0][0];
      expect(request.facts).toMatchObject({ balance: 'USD 600.00', daysOverdue: 10, sender: 'Ana', company: 'Caribe Logística SRL' });
      expect(request.language).toBe('es');
      expect(request.instructions).toContain('firm');

      ai.available.mockReturnValueOnce(false);
      await expect(service.composeReminder(organizationId, { id: null }, open.id, 'formal')).rejects.toMatchObject({
        messageKey: 'collections.ai_not_available',
      });
    });
  });
});
