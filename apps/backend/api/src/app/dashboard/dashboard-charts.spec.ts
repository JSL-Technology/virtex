import { DataSource } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { Product, ProductKind, ProductStatus } from '../inventory/entities/product.entity';
import {
  AccountingPeriod,
  PeriodStatus,
} from '../accounting/entities/accounting-period.entity';
import { DashboardChartsService } from './dashboard-charts.service';

/**
 * The dashboard's charts.
 *
 * Every series on this page was a literal in the browser bundle: the same seven months of sales,
 * the same five expense categories and the same six low-stock products for every customer of the
 * product. These tests are about the property that replaced it — the numbers come from the
 * tenant's own tables, and a tenant that has not traded sees nothing rather than somebody else's
 * trade.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('dashboard charts', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let charts: DashboardChartsService;

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
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();
    charts = new DashboardChartsService(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `DC ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = org.id;

    const customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        organizationId,
        companyName: 'Distribuidora Nacional',
        email: `cliente-${Math.random().toString(36).slice(2, 8)}@ejemplo.do`,
      }),
    );
    customerId = customer.id;
  });

  const isoMonthsAgo = (months: number): string => {
    const date = new Date();
    date.setDate(15);
    date.setMonth(date.getMonth() - months);
    return date.toISOString().slice(0, 10);
  };

  const invoice = (
    total: number,
    issueDate: string,
    status: InvoiceStatus = InvoiceStatus.PENDING,
    dueDate = issueDate,
  ) =>
    dataSource.getRepository(Invoice).save(
      dataSource.getRepository(Invoice).create({
        organizationId,
        customerId,
        customerName: 'Distribuidora Nacional',
        invoiceNumber: `F-${Math.random().toString(36).slice(2, 8)}`,
        issueDate,
        dueDate,
        status,
        currencyCode: 'DOP',
        exchangeRate: 1,
        subtotal: total,
        tax: 0,
        total,
        netReceivable: total,
        balance: status === InvoiceStatus.PAID ? 0 : total,
        totalInBaseCurrency: total,
      } as never) as unknown as Invoice,
    );

  const product = (name: string, stock: number, reorderLevel: number | null) =>
    dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({
        organizationId,
        name,
        price: 100,
        cost: 50,
        stock,
        reorderLevel,
        kind: ProductKind.GOOD,
        status: ProductStatus.ACTIVE,
      }),
    );

  describe('sales trend', () => {
    it('reports the tenant’s own revenue, month by month', async () => {
      await invoice(10_000, isoMonthsAgo(1));
      await invoice(5_000, isoMonthsAgo(1));
      await invoice(3_000, isoMonthsAgo(0));

      const trend = await charts.salesTrend(organizationId, 12);
      expect(trend).toHaveLength(12);
      expect(trend.at(-2)?.amount).toBe(15_000);
      expect(trend.at(-1)?.amount).toBe(3_000);
    });

    it('gives a month with no trade a zero, not a gap', async () => {
      await invoice(1_000, isoMonthsAgo(2));

      // Highcharts draws a straight line across missing months, which reads as a gentle decline
      // where the truth is two months of nothing.
      const trend = await charts.salesTrend(organizationId, 12);
      expect(trend.at(-2)?.amount).toBe(0);
      expect(trend.at(-1)?.amount).toBe(0);
    });

    it('leaves drafts out and lets a credit note subtract', async () => {
      await invoice(9_000, isoMonthsAgo(0), InvoiceStatus.DRAFT);
      await invoice(4_000, isoMonthsAgo(0));
      await invoice(1_000, isoMonthsAgo(0), InvoiceStatus.CREDIT_NOTE);

      const trend = await charts.salesTrend(organizationId, 12);
      expect(trend.at(-1)?.amount).toBe(3_000);
    });

    it('shows a new tenant nothing rather than somebody else’s seven months', async () => {
      const trend = await charts.salesTrend(organizationId, 12);
      expect(trend.every((point) => point.amount === 0)).toBe(true);
    });
  });

  describe('invoice status mix', () => {
    it('splits by value, because ten settled invoices and one unpaid million is not health', async () => {
      await invoice(100, isoMonthsAgo(0), InvoiceStatus.PAID);
      await invoice(1_000_000, isoMonthsAgo(0), InvoiceStatus.PENDING);

      const mix = await charts.invoiceStatusMix(organizationId);
      expect(mix[0]).toMatchObject({ status: InvoiceStatus.PENDING, amount: 1_000_000, count: 1 });
      expect(mix[1]).toMatchObject({ status: InvoiceStatus.PAID, amount: 100, count: 1 });
    });
  });

  describe('low stock', () => {
    it('measures against the reorder level the tenant set, not an invented threshold', async () => {
      await product('Tornillos', 4, 10);
      await product('Tuercas', 40, 10);

      const low = await charts.lowStock(organizationId);
      expect(low.map((item) => item.name)).toEqual(['Tornillos']);
    });

    it('reports an item with no reorder level only once it has actually run out', async () => {
      await product('Arandelas', 2, null);
      await product('Clavos', 0, null);

      const low = await charts.lowStock(organizationId);
      expect(low.map((item) => item.name)).toEqual(['Clavos']);
    });
  });

  describe('alerts', () => {
    it('says nothing is wrong when nothing is', async () => {
      expect(await charts.alerts(organizationId)).toEqual([]);
    });

    it('reports money that should already have arrived', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      await invoice(7_500, isoMonthsAgo(1), InvoiceStatus.PENDING, yesterday.toISOString().slice(0, 10));

      const [alert] = await charts.alerts(organizationId);
      expect(alert).toMatchObject({
        id: 'receivables-overdue',
        severity: 'critical',
        messageKey: 'DASHBOARD.ALERTS.RECEIVABLES_OVERDUE',
      });
      expect(alert.params['amount']).toBe(7_500);
    });

    it('reports a period that ended and was never closed', async () => {
      const ended = new Date();
      ended.setMonth(ended.getMonth() - 1);
      await dataSource.getRepository(AccountingPeriod).save({
        organizationId,
        name: 'Mes pasado',
        startDate: isoMonthsAgo(2) as unknown as Date,
        endDate: ended.toISOString().slice(0, 10) as unknown as Date,
        status: PeriodStatus.OPEN,
      });

      const alerts = await charts.alerts(organizationId);
      expect(alerts.some((alert) => alert.id === 'period-unclosed')).toBe(true);
    });
  });
});
