import { DataSource } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Product } from '../inventory/entities/product.entity';
import { Invoice, InvoiceStatus, InvoiceType } from '../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import { ProfitabilityService } from './profitability.service';

/**
 * Gross margin by product and by customer.
 *
 * The two screens that show these had three invented rows each, written into the Angular component
 * as a signal, and made no request at all — there was no server-side report to request. Every case
 * here is about a document that must or must not count, which is the only thing a margin report is.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('profitability', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let profitability: ProfitabilityService;

  let organizationId: string;
  let customerId: string;
  let otherCustomerId: string;
  let productId: string;

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

    profitability = new ProfitabilityService(
      dataSource.getRepository(InvoiceLineItem),
      dataSource.getRepository(Invoice),
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Margen ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = org.id;

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({ organizationId, baseCurrency: 'DOP' }),
    );

    const stamp = Date.now();
    const customers = await dataSource.getRepository(Customer).save([
      dataSource.getRepository(Customer).create({
        organizationId,
        companyName: 'Cliente A',
        email: `a-${stamp}@ejemplo.test`,
      }),
      dataSource.getRepository(Customer).create({
        organizationId,
        companyName: 'Cliente B',
        email: `b-${stamp}@ejemplo.test`,
      }),
    ]);
    customerId = customers[0].id;
    otherCustomerId = customers[1].id;

    const product = await dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({
        organizationId,
        name: 'Servidor de aplicaciones',
        sku: 'SRV-001',
        price: 1_000,
      }),
    );
    productId = product.id;
  });

  afterEach(async () => {
    // A plain tenant delete. It used to fail here — `invoice_line_item.productId` was `RESTRICT`,
    // so a tenant that had invoiced a stocked product could not be removed at all. See
    // `database/tenant-deletion.spec.ts`.
    await dataSource.getRepository(Organization).delete({ id: organizationId });
  });

  let invoiceCounter = 0;

  /** One document with one line. Amounts are in the document currency. */
  async function issue(options: {
    issueDate: string;
    quantity: number;
    lineSubtotal: number;
    unitCost?: number | null;
    status?: InvoiceStatus;
    type?: InvoiceType;
    customer?: string;
    product?: string | null;
    exchangeRate?: number;
    currencyCode?: string;
  }): Promise<Invoice> {
    invoiceCounter += 1;
    const invoice = await dataSource.getRepository(Invoice).save(
      dataSource.getRepository(Invoice).create({
        organizationId,
        invoiceNumber: `F-${Date.now()}-${invoiceCounter}`,
        customerId: options.customer ?? customerId,
        customerName: options.customer === otherCustomerId ? 'Cliente B' : 'Cliente A',
        issueDate: options.issueDate,
        dueDate: options.issueDate,
        subtotal: options.lineSubtotal,
        tax: 0,
        total: options.lineSubtotal,
        balance: 0,
        status: options.status ?? InvoiceStatus.PENDING,
        type: options.type ?? InvoiceType.INVOICE,
        currencyCode: options.currencyCode ?? 'DOP',
        exchangeRate: options.exchangeRate ?? 1,
        totalInBaseCurrency: options.lineSubtotal * (options.exchangeRate ?? 1),
      }),
    );

    const line = new InvoiceLineItem();
    line.invoice = invoice;
    line.productId = options.product === null ? null : (options.product ?? productId);
    line.description = 'Servidor de aplicaciones';
    line.quantity = options.quantity;
    line.price = options.lineSubtotal / options.quantity;
    line.lineSubtotal = options.lineSubtotal;
    // `unitCost` is declared non-nullable on the entity but the column is nullable: a line sold
    // before its product had a cost genuinely has none, and that is what the report reports.
    line.unitCost = options.unitCost as number;
    await dataSource.getRepository(InvoiceLineItem).save(line);

    return invoice;
  }

  const RANGE = { startDate: '2026-01-01', endDate: '2026-12-31' };

  // ───────────────────────────────────────────────────────────────────────────

  it('computes revenue, cost and margin from the documents issued', async () => {
    await issue({ issueDate: '2026-03-10', quantity: 10, lineSubtotal: 10_000, unitCost: 600 });

    const report = await profitability.byProduct(organizationId, RANGE);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].code).toBe('SRV-001');
    expect(report.rows[0].unitsSold).toBe(10);
    expect(report.rows[0].totalRevenue).toBe(10_000);
    expect(report.rows[0].totalCost).toBe(6_000);
    expect(report.rows[0].grossProfit).toBe(4_000);
    expect(report.rows[0].grossMargin).toBe(40);
    expect(report.currency).toBe('DOP');
  });

  /** A draft is a proposal. Counting it inflates revenue with a sale that never happened. */
  it('leaves drafts out', async () => {
    await issue({
      issueDate: '2026-03-10',
      quantity: 10,
      lineSubtotal: 10_000,
      unitCost: 600,
      status: InvoiceStatus.DRAFT,
    });

    const report = await profitability.byProduct(organizationId, RANGE);
    expect(report.rows).toHaveLength(0);
    expect(report.totals.totalRevenue).toBe(0);
  });

  it('leaves annulled documents out', async () => {
    await issue({
      issueDate: '2026-03-10',
      quantity: 10,
      lineSubtotal: 10_000,
      unitCost: 600,
      status: InvoiceStatus.VOID,
    });

    const report = await profitability.byProduct(organizationId, RANGE);
    expect(report.rows).toHaveLength(0);
  });

  /**
   * A return reverses both sides of the sale. A report that ignores credit notes shows a margin
   * the business did not earn; one that adds them shows revenue it did not receive.
   */
  it('subtracts a credit note from both revenue and cost', async () => {
    await issue({ issueDate: '2026-03-10', quantity: 10, lineSubtotal: 10_000, unitCost: 600 });
    await issue({
      issueDate: '2026-03-20',
      quantity: 4,
      lineSubtotal: 4_000,
      unitCost: 600,
      type: InvoiceType.CREDIT_NOTE,
      status: InvoiceStatus.CREDIT_NOTE,
    });

    const report = await profitability.byProduct(organizationId, RANGE);

    expect(report.rows[0].unitsSold).toBe(6);
    expect(report.rows[0].totalRevenue).toBe(6_000);
    expect(report.rows[0].totalCost).toBe(3_600);
    expect(report.rows[0].grossProfit).toBe(2_400);
  });

  it('counts only the documents inside the period', async () => {
    await issue({ issueDate: '2025-12-31', quantity: 5, lineSubtotal: 5_000, unitCost: 600 });
    await issue({ issueDate: '2026-03-10', quantity: 10, lineSubtotal: 10_000, unitCost: 600 });
    await issue({ issueDate: '2027-01-01', quantity: 5, lineSubtotal: 5_000, unitCost: 600 });

    const report = await profitability.byProduct(organizationId, RANGE);
    expect(report.rows[0].totalRevenue).toBe(10_000);
  });

  /**
   * A peso invoice and a dollar invoice cannot be added. Both are converted at the rate the
   * document was recorded with, which is the rate its own ledger entry used.
   */
  it('states every figure in the books currency', async () => {
    await issue({ issueDate: '2026-03-10', quantity: 10, lineSubtotal: 10_000, unitCost: 600 });
    await issue({
      issueDate: '2026-04-10',
      quantity: 2,
      lineSubtotal: 100,
      unitCost: 40,
      currencyCode: 'USD',
      exchangeRate: 60,
    });

    const report = await profitability.byProduct(organizationId, RANGE);

    // 10,000 DOP plus 100 USD at 60 = 6,000 DOP.
    expect(report.rows[0].totalRevenue).toBe(16_000);
    // 10 × 600 plus 2 × 40 × 60 = 6,000 + 4,800.
    expect(report.rows[0].totalCost).toBe(10_800);
  });

  /**
   * A line sold before its product had a cost produces a 100 % margin. Reporting the count is what
   * stops a reader acting on it.
   *
   * The cost is written as 0, not null, because that is what the application writes: `unit_cost`
   * carries a database default of 0 and a not-null transformer, so "never recorded" and "genuinely
   * free" are the same value in the table. The report counts both, since both mislead.
   */
  it('reports the lines that earned revenue at no recorded cost', async () => {
    await issue({ issueDate: '2026-03-10', quantity: 10, lineSubtotal: 10_000, unitCost: 0 });

    const report = await profitability.byProduct(organizationId, RANGE);

    expect(report.linesWithoutCost).toBe(1);
    expect(report.rows[0].totalCost).toBe(0);
    expect(report.rows[0].grossMargin).toBe(100);
  });

  it('groups an ad-hoc line with no product under one row rather than losing it', async () => {
    await issue({
      issueDate: '2026-03-10',
      quantity: 1,
      lineSubtotal: 500,
      unitCost: 100,
      product: null,
    });

    const report = await profitability.byProduct(organizationId, RANGE);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].totalRevenue).toBe(500);
  });

  it('reports null margin rather than dividing by zero', async () => {
    await issue({ issueDate: '2026-03-10', quantity: 1, lineSubtotal: 0, unitCost: 0 });

    const report = await profitability.byProduct(organizationId, RANGE);
    expect(report.rows[0].grossMargin).toBeNull();
    expect(report.totals.grossMargin).toBeNull();
  });

  it('orders the most profitable first', async () => {
    const second = await dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({
        organizationId,
        name: 'Licencia anual',
        sku: 'LIC-001',
        price: 500,
      }),
    );
    await issue({ issueDate: '2026-03-10', quantity: 1, lineSubtotal: 1_000, unitCost: 900 });
    await issue({
      issueDate: '2026-03-11',
      quantity: 1,
      lineSubtotal: 5_000,
      unitCost: 100,
      product: second.id,
    });

    const report = await profitability.byProduct(organizationId, RANGE);
    expect(report.rows.map((row) => row.code)).toEqual(['LIC-001', 'SRV-001']);
  });

  // ── By customer ────────────────────────────────────────────────────────────

  it('groups by customer', async () => {
    await issue({ issueDate: '2026-03-10', quantity: 10, lineSubtotal: 10_000, unitCost: 600 });
    await issue({
      issueDate: '2026-03-11',
      quantity: 5,
      lineSubtotal: 8_000,
      unitCost: 600,
      customer: otherCustomerId,
    });

    const report = await profitability.byCustomer(organizationId, RANGE);

    expect(report.rows).toHaveLength(2);
    expect(report.totals.totalRevenue).toBe(18_000);
    expect(report.totals.totalCost).toBe(9_000);
    expect(report.totals.grossProfit).toBe(9_000);
    expect(report.totals.grossMargin).toBe(50);
  });

  it('refuses a range that runs backwards', async () => {
    await expect(
      profitability.byProduct(organizationId, { startDate: '2026-12-31', endDate: '2026-01-01' }),
    ).rejects.toThrow();
  });

  it('refuses a range wider than a report may cover', async () => {
    await expect(
      profitability.byProduct(organizationId, { startDate: '2000-01-01', endDate: '2026-01-01' }),
    ).rejects.toThrow();
  });

  it('does not read another tenant documents', async () => {
    await issue({ issueDate: '2026-03-10', quantity: 10, lineSubtotal: 10_000, unitCost: 600 });

    const other = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Otra ${Date.now()}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    try {
      const report = await profitability.byProduct(other.id, RANGE);
      expect(report.rows).toHaveLength(0);
    } finally {
      await dataSource.getRepository(Organization).delete({ id: other.id });
    }
  });
});
