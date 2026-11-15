// The invoice renderer loads puppeteer at import; nothing here renders a page.
jest.mock('puppeteer', () => ({}));

import { DataSource } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { PaymentLikelihoodRegistry } from '../contracts/ai/payment-likelihood.contract';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { CollectionsService } from './collections.service';
import { CollectionActivity } from './entities/collection-activity.entity';
import { AutomaticRemindersService } from './automatic-reminders.service';
import { AutomaticRemindersScheduler } from './automatic-reminders.scheduler';

/**
 * The reminder schedule against a real database (TES-13): what goes out on which day, what waits,
 * what never goes, and that no step is sent twice — not by a second run, not by two at once.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

/** A date `days` from today in Santo Domingo (UTC−4 all year), where the test company keeps books. */
const isoDaysFromToday = (days: number) => {
  const now = new Date(Date.now() - 4 * 3_600_000);
  now.setUTCDate(now.getUTCDate() + days);
  return now.toISOString().slice(0, 10);
};

describeWithDb('automatic payment reminders', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let collections: CollectionsService;
  let reminders: AutomaticRemindersService;
  const mail = { sendPaymentReminder: jest.fn().mockResolvedValue(undefined) };
  const ai = { available: jest.fn().mockReturnValue(true), compose: jest.fn(), extract: jest.fn() };
  const entitlements = { checkFeature: jest.fn().mockResolvedValue(true) };
  const renderer = {
    emailSummary: jest.fn().mockReturnValue({ language: 'es', total: 'USD 1,000.00', balance: 'USD 600.00', dueDate: '1 de octubre de 2026' }),
    renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
  };
  const invoices = {
    renderContext: jest.fn(async (id: string) => ({ invoice: { id }, context: { organization: { legalName: 'QA Cobros SRL' } } })),
    senderIdentity: jest.fn().mockResolvedValue({ senderName: 'QA Cobros', replyTo: 'cobros@qa.test', copyTo: null }),
  };

  let organizationId: string;
  let customerId: string;
  let today: string;

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

  const organization = async (): Promise<string> => {
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [row]: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO "organizations" ("legal_name", "slug", "timezone", "subscription_status")
       VALUES ($1, $2, 'America/Santo_Domingo', 'active') RETURNING "id"`,
      [`QA-RECORDATORIOS ${tag}`, `qa-rec-${tag}`],
    );
    await dataSource.query(`INSERT INTO "organization_settings" ("organization_id") VALUES ($1)`, [row.id]);
    return row.id;
  };

  const schedule = (days: number[] | null) =>
    dataSource.query(
      `UPDATE organization_settings SET collections_automatic_reminders = $2, collections_reminder_days = $3 WHERE organization_id = $1`,
      [organizationId, days !== null, days ?? [-3, 1, 7, 15, 30]],
    );

  const customer = async (overrides: Partial<Customer> = {}) =>
    (
      await dataSource.getRepository(Customer).save(
        dataSource.getRepository(Customer).create({
          organizationId,
          companyName: 'QA Cliente',
          email: `qa-${Math.random().toString(36).slice(2, 8)}@ejemplo.do`,
          ...overrides,
        }),
      )
    ).id;

  /** An open invoice `daysOverdue` past its due date (negative: not yet due). */
  const invoice = async (daysOverdue: number, custId = customerId, balance = 600) =>
    (
      await dataSource.getRepository(Invoice).save(
        dataSource.getRepository(Invoice).create({
          organizationId,
          customerId: custId,
          customerName: 'QA Cliente',
          invoiceNumber: `QA-${Math.random().toString(36).slice(2, 8)}`,
          issueDate: isoDaysFromToday(-daysOverdue - 30),
          dueDate: isoDaysFromToday(-daysOverdue),
          status: InvoiceStatus.PENDING,
          currencyCode: 'USD',
          exchangeRate: 1,
          subtotal: 1000,
          tax: 0,
          total: 1000,
          netReceivable: 1000,
          balance,
          totalInBaseCurrency: 1000,
        } as never) as unknown as Invoice,
      )
    ).id;

  const steps = async (invoiceId: string) =>
    (
      await dataSource.getRepository(CollectionActivity).find({
        where: { organizationId, invoiceId, kind: 'REMINDER' },
        order: { scheduleStep: 'ASC' },
      })
    ).map((row) => row.scheduleStep);

  beforeEach(async () => {
    jest.clearAllMocks();
    mail.sendPaymentReminder.mockResolvedValue(undefined);
    collections = new CollectionsService(
      dataSource,
      dataSource.getRepository(CollectionActivity),
      invoices as never,
      renderer as never,
      mail as never,
      new PaymentLikelihoodRegistry(),
      ai as never,
      entitlements as never,
    );
    reminders = new AutomaticRemindersService(dataSource, collections, dataSource.getRepository(CollectionActivity));
    organizationId = await organization();
    customerId = await customer();
    today = isoDaysFromToday(0);
  });

  it('sends nothing until the company turns the schedule on', async () => {
    await invoice(1);
    await expect(reminders.run(organizationId, today)).resolves.toMatchObject({ sent: 0 });
    expect(mail.sendPaymentReminder).not.toHaveBeenCalled();
  });

  it('sends each invoice the step it is at, once, and never a step after a later one', async () => {
    await schedule([-3, 1, 7]);
    const beforeDue = await invoice(-3);
    const dayAfter = await invoice(1);
    const weekLate = await invoice(9);
    const longGone = await invoice(40); // past the last step's grace: a person's, not the schedule's
    const notYet = await invoice(-10);

    await expect(reminders.run(organizationId, today)).resolves.toEqual({ sent: 3, postponed: 0, skipped: 0, failed: 0 });
    expect(await steps(beforeDue)).toEqual([-3]);
    expect(await steps(dayAfter)).toEqual([1]);
    expect(await steps(weekLate)).toEqual([7]);
    expect(await steps(longGone)).toEqual([]);
    expect(await steps(notYet)).toEqual([]);

    // The e-mail is the template's — no generated note — named after the claim, to the customer.
    const [first] = mail.sendPaymentReminder.mock.calls.map((call) => call[0]);
    expect(first).toMatchObject({ message: null, to: expect.stringMatching(/@ejemplo\.do$/), jobId: expect.stringMatching(/^collection-reminder-/) });
    expect(first.jobId).not.toContain(':');
    expect(ai.compose).not.toHaveBeenCalled();

    // A second run the same day finds nothing new to send.
    await expect(reminders.run(organizationId, today)).resolves.toMatchObject({ sent: 0 });
    expect(mail.sendPaymentReminder).toHaveBeenCalledTimes(3);

    // Two days later the 1-day step is done and the 7-day step has not come: nothing again.
    await expect(reminders.run(organizationId, isoDaysFromToday(2))).resolves.toMatchObject({ sent: 0 });
    // …and when it comes, the 1-day invoice gets it.
    await reminders.run(organizationId, isoDaysFromToday(6));
    expect(await steps(dayAfter)).toEqual([1, 7]);
  });

  it('two runs at once send each step once', async () => {
    await schedule([1]);
    const invoices = await Promise.all([invoice(1), invoice(2), invoice(3)]);

    const [a, b] = await Promise.all([reminders.run(organizationId, today), reminders.run(organizationId, today)]);

    expect(a.sent + b.sent).toBe(3);
    expect(mail.sendPaymentReminder).toHaveBeenCalledTimes(3);
    for (const id of invoices) expect(await steps(id)).toEqual([1]);
  });

  it('waits while a promise is in date or someone was just in touch; a dispute is a person’s', async () => {
    await schedule([1]);
    const promised = await invoice(2);
    const called = await invoice(2);
    const disputed = await invoice(2);
    const plain = await invoice(2);
    const anyone = '44444444-4444-4444-8444-444444444444';
    await collections.log(organizationId, anyone, { invoiceId: promised, kind: 'PROMISE', promisedDate: isoDaysFromToday(4) });
    await collections.log(organizationId, anyone, { invoiceId: called, kind: 'CALL', outcome: 'no_answer' });
    // The dispute was a week ago: not a recent contact, still the last word on the invoice.
    await dataSource.getRepository(CollectionActivity).save({
      organizationId,
      customerId,
      invoiceId: disputed,
      kind: 'CALL',
      status: 'DONE',
      outcome: 'disputed',
      occurredAt: new Date(Date.now() - 7 * 86_400_000),
    });

    await expect(reminders.run(organizationId, today)).resolves.toEqual({ sent: 1, postponed: 2, skipped: 1, failed: 0 });
    expect(await steps(plain)).toEqual([1]);
    expect(await steps(promised)).toEqual([]);
    expect(await steps(called)).toEqual([]);
    expect(await steps(disputed)).toEqual([]);

    // Four days on the call is no longer recent and the step is still in its grace: it goes.
    await reminders.run(organizationId, isoDaysFromToday(4));
    expect(await steps(called)).toEqual([1]);
  });

  it('a customer taken out of the schedule, or with no address, is not reminded', async () => {
    await schedule([1]);
    const excluded = await invoice(1, await customer({ automaticReminders: false }));
    const noAddress = await invoice(1, await customer({ email: null as never }));

    await expect(reminders.run(organizationId, today)).resolves.toMatchObject({ sent: 0, skipped: 1 });
    expect(await steps(excluded)).toEqual([]);
    expect(await steps(noAddress)).toEqual([]);
  });

  it('an e-mail that could not be queued releases its step for the next run', async () => {
    await schedule([1]);
    const open = await invoice(1);
    mail.sendPaymentReminder.mockRejectedValueOnce(new Error('redis down'));

    await expect(reminders.run(organizationId, today)).resolves.toMatchObject({ sent: 0, failed: 1 });
    expect(await steps(open)).toEqual([]);

    await expect(reminders.run(organizationId, today)).resolves.toMatchObject({ sent: 1 });
    expect(await steps(open)).toEqual([1]);
  });

  describe('when it runs', () => {
    const scheduler = () => new AutomaticRemindersScheduler(dataSource, reminders, new SchedulerLockService(dataSource));
    /** An instant at `hour` o'clock in Santo Domingo today. */
    const at = (hour: number) => new Date(`${isoDaysFromToday(0)}T${String(hour + 4).padStart(2, '0')}:10:00Z`);

    it('at the first run after nine on the company’s own clock, once that day', async () => {
      const due = async (instant: Date) =>
        (await scheduler().companiesDue(instant)).some((company) => company.organizationId === organizationId);

      expect(await due(at(8))).toBe(false);
      expect(await due(at(9))).toBe(true);

      await schedule([1]);
      await invoice(1);
      const [company] = (await scheduler().companiesDue(at(9))).filter((entry) => entry.organizationId === organizationId);
      expect(company.today).toBe(isoDaysFromToday(0));
      await expect(scheduler().runCompany(organizationId, company.today)).resolves.toBe(true);
      expect(mail.sendPaymentReminder).toHaveBeenCalledTimes(1);
      // Claimed for the day: the next hour does not offer it, and a second run does nothing.
      expect(await due(at(10))).toBe(false);
      await expect(scheduler().runCompany(organizationId, company.today)).resolves.toBe(false);
      expect(mail.sendPaymentReminder).toHaveBeenCalledTimes(1);
    });

    it('not for a company whose subscription has lapsed', async () => {
      await dataSource.query(`UPDATE organizations SET subscription_status = 'canceled', grace_period_end = NULL WHERE id = $1`, [organizationId]);
      const due = await scheduler().companiesDue(at(10));
      expect(due.some((company) => company.organizationId === organizationId)).toBe(false);
    });
  });
});
