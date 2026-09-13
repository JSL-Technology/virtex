import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Organization } from '../organizations/entities/organization.entity';
import { AuditLog, ActionType } from '../audit/entities/audit-log.entity';
import { User } from '../users/entities/user.entity/user.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { VendorBill, VendorBillStatus } from '../accounts-payable/entities/vendor-bill.entity';
import {
  AccountingPeriod,
  PeriodStatus,
} from '../accounting/entities/accounting-period.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { PERMISSIONS } from '../shared/permissions';
import { OverviewService } from './overview.service';

/**
 * The workspace home page.
 *
 * What it showed before was invented in the browser: six invoices and payments that did not exist,
 * three product announcements nobody published and three calendar entries nobody scheduled, served
 * through a simulated delay so the loading states looked convincing. These tests are mostly about
 * the opposite property — that nothing appears here that is not in a table.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('overview', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let overview: OverviewService;
  let auditLogs: Repository<AuditLog>;

  let organizationId: string;
  let customerId: string;
  let actorId: string;

  const ALL = ['*'];
  const SALES_ONLY = [PERMISSIONS.INVOICES_VIEW];

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
    auditLogs = dataSource.getRepository(AuditLog);

    overview = new OverviewService(
      auditLogs,
      dataSource.getRepository(User),
      dataSource.getRepository(Invoice),
      dataSource.getRepository(VendorBill),
      dataSource.getRepository(AccountingPeriod),
      { get: () => undefined } as unknown as ConfigService,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `OV ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = org.id;

    const actor = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: `ov-${Math.random().toString(36).slice(2, 8)}@ejemplo.do`,
        firstName: 'Ada',
        lastName: 'Lovelace',
        organizationId,
      }),
    );
    actorId = actor.id;

    const customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        organizationId,
        companyName: 'Distribuidora Nacional',
        email: `cliente-${Math.random().toString(36).slice(2, 8)}@ejemplo.do`,
      }),
    );
    customerId = customer.id;
  });

  const audit = (entity: string, actionType: ActionType, newValue: object) =>
    auditLogs.save(
      auditLogs.create({
        organizationId,
        userId: actorId,
        entity,
        entityId: '00000000-0000-4000-8000-000000000001',
        actionType,
        newValue,
      }),
    );

  const openInvoice = (balance: number, dueDate: string, number = 'FAC-0001') =>
    dataSource.getRepository(Invoice).save(
      dataSource.getRepository(Invoice).create({
        organizationId,
        customerId,
        customerName: 'Distribuidora Nacional',
        invoiceNumber: number,
        issueDate: '2026-05-01',
        dueDate,
        status: InvoiceStatus.PENDING,
        currencyCode: 'DOP',
        exchangeRate: 1,
        subtotal: balance,
        tax: 0,
        total: balance,
        netReceivable: balance,
        balance,
        totalInBaseCurrency: balance,
      } as never) as unknown as Invoice,
    );

  describe('activity', () => {
    it('reports what actually happened, with the document’s own number and amount', async () => {
      await audit('invoices', ActionType.CREATE, {
        invoiceNumber: 'FAC-00000042',
        customerName: 'Distribuidora Nacional',
        total: 45_800,
        currencyCode: 'DOP',
      });

      const [item] = await overview.activity(organizationId, ALL);
      expect(item).toMatchObject({
        entity: 'invoices',
        action: 'CREATE',
        reference: 'FAC-00000042',
        counterparty: 'Distribuidora Nacional',
        amount: 45_800,
        currencyCode: 'DOP',
        actorName: 'Ada Lovelace',
      });
    });

    it('leaves out the provisioning noise that would otherwise be the whole feed', async () => {
      // A new tenant writes a hundred of these before anybody does any business.
      await audit('accounting_periods', ActionType.CREATE, { name: 'Enero 2026' });
      await audit('document_sequences', ActionType.CREATE, { prefix: 'FAC' });
      await audit('ledgers', ActionType.CREATE, { name: 'Principal' });

      expect(await overview.activity(organizationId, ALL)).toEqual([]);
    });

    it('is not activity when somebody merely looked at something', async () => {
      await audit('invoices', ActionType.READ, { invoiceNumber: 'FAC-00000042' });

      expect(await overview.activity(organizationId, ALL)).toEqual([]);
    });

    it('shows each seat only the documents it may read', async () => {
      await audit('invoices', ActionType.CREATE, { invoiceNumber: 'FAC-00000042' });
      await audit('journal_entries', ActionType.CREATE, { entryNumber: 'NOMINA-2026-000001' });

      const seller = await overview.activity(organizationId, SALES_ONLY);
      expect(seller.map((item) => item.entity)).toEqual(['invoices']);

      // Not "shown but redacted": that the payroll entry exists is most of the secret.
      expect(seller.some((item) => item.reference === 'NOMINA-2026-000001')).toBe(false);
    });

    it('understands a wildcard grant the way the permission guard does', async () => {
      await audit('invoices', ActionType.CREATE, { invoiceNumber: 'FAC-00000042' });

      // An administrator carries `*`, not the literal `invoices:view`. A membership test showed
      // them an empty page.
      expect(await overview.activity(organizationId, ['*'])).toHaveLength(1);
      expect(await overview.activity(organizationId, ['invoices:*'])).toHaveLength(1);
    });

    it('says nothing rather than something invented when the tenant is new', async () => {
      expect(await overview.activity(organizationId, ALL)).toEqual([]);
    });
  });

  describe('events', () => {
    const today = new Date().toISOString().slice(0, 10);
    const inDays = (days: number) => {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return date.toISOString().slice(0, 10);
    };

    it('lists what falls due, and marks what already has', async () => {
      await openInvoice(1_000, inDays(5), 'FAC-0002');
      await openInvoice(2_000, inDays(-5), 'FAC-0003');

      const events = await overview.events(organizationId, ALL);
      expect(events.find((e) => e.reference === 'FAC-0002')?.kind).toBe('RECEIVABLE_DUE');
      expect(events.find((e) => e.reference === 'FAC-0003')?.kind).toBe('RECEIVABLE_OVERDUE');
    });

    it('carries the balance outstanding, not the invoice total', async () => {
      const invoice = await openInvoice(5_000, inDays(3), 'FAC-0004');
      await dataSource.getRepository(Invoice).update(invoice.id, {
        balance: 1_250,
        status: InvoiceStatus.PARTIALLY_PAID,
      });

      const [event] = await overview.events(organizationId, ALL);
      expect(event.amount).toBe(1_250);
    });

    it('includes a period that is still open and about to end', async () => {
      await dataSource.getRepository(AccountingPeriod).save({
        organizationId,
        name: 'Mes en curso',
        startDate: today as unknown as Date,
        endDate: inDays(10) as unknown as Date,
        status: PeriodStatus.OPEN,
      });

      const events = await overview.events(organizationId, ALL);
      expect(events.some((e) => e.kind === 'PERIOD_CLOSE' && e.reference === 'Mes en curso')).toBe(
        true,
      );
    });

    it('shows a seat only the obligations of the modules it may read', async () => {
      await openInvoice(1_000, inDays(5), 'FAC-0005');
      const supplier = await dataSource.getRepository(Supplier).save(
        dataSource.getRepository(Supplier).create({ organizationId, name: 'Suplidora del Este' }),
      );
      await dataSource.getRepository(VendorBill).save(
        dataSource.getRepository(VendorBill).create({
          organizationId,
          vendorId: supplier.id,
          ncf: 'B0100000001',
          date: new Date() as never,
          dueDate: inDays(4) as never,
          subtotal: 500,
          total: 500,
          balance: 500,
          status: VendorBillStatus.OPEN,
        } as never),
      );

      const seller = await overview.events(organizationId, SALES_ONLY);
      expect(seller.map((e) => e.kind)).toEqual(['RECEIVABLE_DUE']);
    });

    it('does not invent a fiscal calendar', async () => {
      // Filing dates are law and differ per market and per taxpayer regime. A tenant who files
      // late because a screen showed the wrong day has been harmed by the software.
      const events = await overview.events(organizationId, ALL);
      expect(events).toEqual([]);
    });
  });

  describe('news', () => {
    it('is empty when no feed is configured, rather than three announcements nobody published', async () => {
      expect(await overview.news()).toEqual([]);
    });
  });
});
