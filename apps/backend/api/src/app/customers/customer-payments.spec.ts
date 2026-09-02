import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { Customer } from './entities/customer.entity';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';
import {
  AccountCategory,
  AccountNature,
  AccountRole,
  AccountType,
} from '../chart-of-accounts/enums/account-enums';
import {
  AccountingPeriod,
  PeriodStatus,
} from '../accounting/entities/accounting-period.entity';
import { JournalEntry } from '../journal-entries/entities/journal-entry.entity';
import { JournalEntryAttachment } from '../journal-entries/entities/journal-entry-attachment.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { JournalEntryNumberingService } from '../journal-entries/journal-entry-numbering.service';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { CustomerPaymentsService } from './customer-payments.service';
import {
  CustomerPayment,
  CustomerPaymentStatus,
} from './entities/customer-payment.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import {
  BankAccount,
  BankAccountType,
} from '../treasury/entities/bank-account.entity';

/**
 * Collections from customers.
 *
 * The three things this module could not previously do at all: withhold, hold an advance, and
 * reverse a bounced cheque.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('customer collections', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let receipts: CustomerPaymentsService;
  let balances: AccountBalancesService;

  let organizationId: string;
  let ledgerId: string;
  let customerId: string;
  const account: Record<string, string> = {};
  let bankAccountId: string;

  const ACTOR = '33333333-3333-4333-8333-333333333333';

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

    const audit = new AuditTrailService(dataSource.getRepository(AuditLog));
    balances = new AccountBalancesService(dataSource);
    const numbering = new JournalEntryNumberingService();
    const entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null) } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      numbering,
      audit,
    );

    receipts = new CustomerPaymentsService(
      dataSource.getRepository(CustomerPayment),
      entries,
      numbering,
      new ExchangeRateResolver(dataSource),
      dataSource,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `AR ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = org.id;

    const ledger = await dataSource.getRepository(Ledger).save(
      dataSource.getRepository(Ledger).create({
        organizationId,
        name: 'Principal',
        currency: 'DOP',
        isDefault: true,
        isActive: true,
      }),
    );
    ledgerId = ledger.id;

    await dataSource.getRepository(Journal).save([
      { organizationId, code: 'COBROS', name: 'Cobros', type: 'BANK' as const },
      { organizationId, code: 'VENTAS', name: 'Ventas', type: 'SALES' as const },
    ]);

    const make = async (
      key: string,
      code: string,
      type: AccountType,
      category: AccountCategory,
      nature: AccountNature,
      systemRole: AccountRole | null = null,
    ) => {
      const saved = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId,
          code,
          name: { es: code },
          type,
          category,
          nature,
          systemRole,
          isPostable: true,
          isActive: true,
        }),
      );
      account[key] = saved.id;
    };

    await make('bank', '1102', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.BANK);
    await make('receivable', '1201', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.ACCOUNTS_RECEIVABLE);
    await make('withholdingReceivable', '1170', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.WITHHOLDING_RECEIVABLE);
    await make('discount', '4901', AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, AccountNature.DEBIT, AccountRole.SALES_DISCOUNTS);
    await make('forex', '5901', AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, AccountNature.DEBIT, AccountRole.FOREX_GAIN_LOSS);
    await make('revenue', '4101', AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, AccountNature.CREDIT, AccountRole.SALES_REVENUE);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({
        organizationId,
        baseCurrency: 'DOP',
        defaultAccountsReceivableId: account['receivable'],
        defaultForexGainLossAccountId: account['forex'],
      }),
    );

    await dataSource.getRepository(AccountingPeriod).save([
      { organizationId, name: 'Mayo 2026', startDate: '2026-05-01' as unknown as Date, endDate: '2026-05-31' as unknown as Date, status: PeriodStatus.OPEN },
      { organizationId, name: 'Junio 2026', startDate: '2026-06-01' as unknown as Date, endDate: '2026-06-30' as unknown as Date, status: PeriodStatus.OPEN },
    ]);

    const customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        organizationId,
        companyName: 'Distribuidora Nacional',
        email: `cliente-${Math.random().toString(36).slice(2, 8)}@ejemplo.do`,
      }),
    );
    customerId = customer.id;

    // Payments leave (or land in) a real bank account now, not a control account: two
    // accounts sharing one control account produced indistinguishable payments, and a bank
    // statement could never be matched back to either.
    const bankAccount = await dataSource.getRepository(BankAccount).save(
      dataSource.getRepository(BankAccount).create({
        organizationId,
        name: 'Cuenta de cobros',
        accountNumber: `AR-${Date.now()}`,
        accountType: BankAccountType.CHECKING,
        currencyCode: 'DOP',
        glAccountId: account['bank'],
      }),
    );
    bankAccountId = bankAccount.id;
  });

  afterEach(async () => {
    await dataSource
      .getRepository(Organization)
      .delete({ id: organizationId });
    await dataSource.query('DELETE FROM "exchange_rate"');
  });

  /**
   * An issued invoice, written directly.
   *
   * The invoicing module has its own suite; what matters here is an open receivable with a known
   * balance, currency and rate.
   */
  const openInvoice = async (
    amount: number,
    options: { currencyCode?: string; exchangeRate?: number; dueDate?: string } = {},
  ): Promise<Invoice> =>
    dataSource.getRepository(Invoice).save(
      dataSource.getRepository(Invoice).create({
        organizationId,
        customerId,
        customerName: 'Distribuidora Nacional',
        invoiceNumber: `F-${Math.random().toString(36).slice(2, 8)}`,
        issueDate: '2026-05-01',
        dueDate: options.dueDate ?? '2026-05-31',
        status: InvoiceStatus.PENDING,
        currencyCode: options.currencyCode ?? 'DOP',
        exchangeRate: options.exchangeRate ?? 1,
        subtotal: amount,
        tax: 0,
        total: amount,
        netReceivable: amount,
        balance: amount,
        totalInBaseCurrency: amount * (options.exchangeRate ?? 1),
      } as never) as unknown as Invoice,
    );

  const signedBalance = async (key: string, asOf = '2026-06-30') =>
    (await balances.balancesAsOf({ organizationId, ledgerId, asOf })).get(account[key]) ?? 0;

  it('applies a collection and relieves the receivable', async () => {
    const invoice = await openInvoice(10_000);

    const receipt = await receipts.create(
      {
        customerId,
        paymentDate: '2026-05-15',
        bankAccountId,
        amountReceived: 10_000,
        lines: [{ invoiceId: invoice.id, amount: 10_000 }],
      },
      organizationId,
      ACTOR,
    );

    expect(receipt.receiptNumber).toMatch(/^REC-2026-\d{6}$/);
    expect(await signedBalance('bank')).toBe(10_000);
    expect(await signedBalance('receivable')).toBe(-10_000);

    const after = await dataSource.getRepository(Invoice).findOneByOrFail({ id: invoice.id });
    expect(after.status).toBe(InvoiceStatus.PAID);
    expect(after.balance).toBe(0);
  });

  it('settles the withheld portion without cash arriving', async () => {
    const invoice = await openInvoice(10_000);

    // The customer keeps 1,000 of ISR and pays it to the authority on our behalf.
    await receipts.create(
      {
        customerId,
        paymentDate: '2026-05-20',
        bankAccountId,
        amountReceived: 9_000,
        lines: [
          { invoiceId: invoice.id, amount: 9_000, incomeTaxWithheld: 1_000 },
        ],
      },
      organizationId,
      ACTOR,
    );

    const after = await dataSource.getRepository(Invoice).findOneByOrFail({ id: invoice.id });
    // The invoice is fully settled even though only 9,000 arrived. Without a withholding field the
    // receivable stayed 1,000 short forever.
    expect(after.status).toBe(InvoiceStatus.PAID);
    expect(after.balance).toBe(0);

    expect(await signedBalance('bank')).toBe(9_000);
    expect(await signedBalance('withholdingReceivable')).toBe(1_000);
    expect(await signedBalance('receivable')).toBe(-10_000);
  });

  it('holds an overpayment as unapplied cash instead of refusing it', async () => {
    const invoice = await openInvoice(5_000);

    const receipt = await receipts.create(
      {
        customerId,
        paymentDate: '2026-05-20',
        bankAccountId,
        amountReceived: 8_000,
        lines: [{ invoiceId: invoice.id, amount: 5_000 }],
      },
      organizationId,
      ACTOR,
    );

    expect(receipt.unappliedAmount).toBe(3_000);
    expect(await signedBalance('bank')).toBe(8_000);
    // 5,000 relieved plus 3,000 held as an advance: the receivable account carries both.
    expect(await signedBalance('receivable')).toBe(-8_000);
  });

  it('records a pure advance with no invoice at all', async () => {
    const receipt = await receipts.create(
      {
        customerId,
        paymentDate: '2026-05-10',
        bankAccountId,
        amountReceived: 4_000,
        lines: [],
      },
      organizationId,
      ACTOR,
    );

    expect(receipt.unappliedAmount).toBe(4_000);
    expect(await signedBalance('bank')).toBe(4_000);
  });

  it('books the realised exchange difference on a foreign-currency invoice', async () => {
    await dataSource.getRepository(ExchangeRate).save({
      fromCurrency: 'USD',
      toCurrency: 'DOP',
      rate: 60,
      date: new Date('2026-05-15T00:00:00.000Z'),
    });

    // Booked at 58, collected at 60: the peso weakened, so we receive more than the receivable
    // was carried at. A gain.
    const invoice = await openInvoice(1_000, { currencyCode: 'USD', exchangeRate: 58 });

    await receipts.create(
      {
        customerId,
        paymentDate: '2026-05-20',
        bankAccountId,
        amountReceived: 1_000,
        currencyCode: 'USD',
        lines: [{ invoiceId: invoice.id, amount: 1_000 }],
      },
      organizationId,
      ACTOR,
    );

    expect(await signedBalance('bank')).toBe(60_000);
    expect(await signedBalance('receivable')).toBe(-58_000);
    // A credit to the exchange account: a gain, so negative under `debit − credit`.
    expect(await signedBalance('forex')).toBe(-2_000);
  });

  it('reverses a bounced cheque and puts the balance back', async () => {
    const invoice = await openInvoice(10_000);
    const receipt = await receipts.create(
      {
        customerId,
        paymentDate: '2026-05-15',
        bankAccountId,
        amountReceived: 10_000,
        lines: [{ invoiceId: invoice.id, amount: 10_000 }],
      },
      organizationId,
      ACTOR,
    );

    const voided = await receipts.voidPayment(
      receipt.id,
      { reason: 'Cheque devuelto por fondos insuficientes', reversalDate: '2026-05-25' },
      organizationId,
      ACTOR,
    );

    expect(voided.status).toBe(CustomerPaymentStatus.VOID);
    expect(voided.reversalJournalEntryId).toBeTruthy();

    const after = await dataSource.getRepository(Invoice).findOneByOrFail({ id: invoice.id });
    expect(after.status).toBe(InvoiceStatus.PENDING);
    expect(after.balance).toBe(10_000);

    // The ledger is back where it started, through a reversing entry rather than a deletion.
    expect(await signedBalance('bank')).toBe(0);
    expect(await signedBalance('receivable')).toBe(0);
  });

  it('refuses to apply more than an invoice owes', async () => {
    const invoice = await openInvoice(1_000);
    await expect(
      receipts.create(
        {
          customerId,
          paymentDate: '2026-05-15',
          bankAccountId,
          amountReceived: 5_000,
          lines: [{ invoiceId: invoice.id, amount: 5_000 }],
        },
        organizationId,
        ACTOR,
      ),
    ).rejects.toThrow();
  });

  it('ages receivables by how overdue they are', async () => {
    await openInvoice(1_000, { dueDate: '2026-06-30' });
    await openInvoice(2_000, { dueDate: '2026-05-20' });
    await openInvoice(3_000, { dueDate: '2026-03-01' });

    const aging = await receipts.aging(organizationId, '2026-05-25');
    const row = aging.rows.find((candidate) => candidate.partyId === customerId);

    expect(row?.current).toBe(1_000);
    expect(row?.buckets.find((bucket) => bucket.label === '1-30')?.amount).toBe(2_000);
    expect(row?.buckets.find((bucket) => bucket.label === '61-90')?.amount).toBe(3_000);
    expect(aging.totals.total).toBe(6_000);
  });
});
