import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
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
import { AccountsPayableService } from './accounts-payable.service';
import { VendorBill, VendorBillStatus } from './entities/vendor-bill.entity';
import { CreateVendorBillDto } from './dto/create-vendor-bill.dto';
import {
  BankAccount,
  BankAccountType,
} from '../treasury/entities/bank-account.entity';

/**
 * Supplier invoices, from recording to settlement.
 *
 * The two assertions that matter most here are the ones the audit found missing entirely: that the
 * tax and withholding a bill describes reach the ledger, and that paying a foreign-currency bill at
 * a different rate books the realised exchange difference instead of leaving payables unclearable.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('accounts payable', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let payables: AccountsPayableService;
  let balances: AccountBalancesService;

  let organizationId: string;
  let ledgerId: string;
  let vendorId: string;
  const account: Record<string, string> = {};
  let bankAccountId: string;

  const ACTOR = '22222222-2222-4222-8222-222222222222';

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
    const entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null) } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      audit,
    );

    payables = new AccountsPayableService(
      dataSource.getRepository(VendorBill),
      dataSource.getRepository(OrganizationSettings),
      entries,
      { increaseStock: jest.fn().mockResolvedValue(undefined) } as never,
      dataSource,
      new EventEmitter2(),
      { startApprovalProcess: jest.fn().mockResolvedValue(null) } as never,
      { checkBudget: jest.fn().mockResolvedValue({ isExceeded: false }) } as never,
      new ExchangeRateResolver(dataSource),
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `AP ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      { organizationId, code: 'COMPRAS', name: 'Compras', type: 'PURCHASES' as const },
      { organizationId, code: 'PAGOS', name: 'Pagos', type: 'BANK' as const },
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
    await make('taxReceivable', '1160', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.TAX_RECEIVABLE);
    await make('payable', '2101', AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, AccountNature.CREDIT, AccountRole.ACCOUNTS_PAYABLE);
    await make('withholding', '2140', AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, AccountNature.CREDIT, AccountRole.WITHHOLDING_PAYABLE);
    await make('expense', '5101', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);
    await make('forex', '5901', AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, AccountNature.DEBIT, AccountRole.FOREX_GAIN_LOSS);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({
        organizationId,
        baseCurrency: 'DOP',
        defaultAccountsPayableId: account['payable'],
        defaultForexGainLossAccountId: account['forex'],
      }),
    );

    await dataSource.getRepository(AccountingPeriod).save([
      { organizationId, name: 'Marzo 2026', startDate: '2026-03-01' as unknown as Date, endDate: '2026-03-31' as unknown as Date, status: PeriodStatus.OPEN },
      { organizationId, name: 'Abril 2026', startDate: '2026-04-01' as unknown as Date, endDate: '2026-04-30' as unknown as Date, status: PeriodStatus.OPEN },
    ]);

    const vendor = await dataSource.getRepository(Supplier).save(
      dataSource.getRepository(Supplier).create({ organizationId, name: 'Suplidora del Caribe' }),
    );
    vendorId = vendor.id;

    // Payments leave (or land in) a real bank account now, not a control account: two
    // accounts sharing one control account produced indistinguishable payments, and a bank
    // statement could never be matched back to either.
    const bankAccount = await dataSource.getRepository(BankAccount).save(
      dataSource.getRepository(BankAccount).create({
        organizationId,
        name: 'Cuenta de pagos',
        accountNumber: `AP-${Date.now()}`,
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
      .delete({ id: organizationId })
      .catch(() => undefined);
    // Rates are deliberately not tenant-scoped — what a currency was worth on a day is a fact
    // about the market — so they outlive the tenant and have to be cleared between tests.
    // Raw DELETE, not `repository.delete({})`: TypeORM rejects empty criteria outright, and a
    // swallowed rejection here leaves a stale rate that quietly changes the next test's arithmetic.
    await dataSource.query('DELETE FROM "exchange_rate"');
  });

  const signedBalance = async (key: string, asOf = '2026-04-30') =>
    (await balances.balancesAsOf({ organizationId, ledgerId, asOf })).get(account[key]) ?? 0;

  describe('recording', () => {
    it('recomputes the total from the lines rather than trusting the caller', async () => {
      await expect(
        payables.create(
          {
            vendorId,
            date: '2026-03-05' as unknown as Date,
            dueDate: '2026-04-04' as unknown as Date,
            lines: [
              { product: 'Servicio', quantity: 2, unitPrice: 500, total: 999_999 },
            ],
            total: 999_999,
          } as CreateVendorBillDto,
          organizationId,
        ),
      ).rejects.toThrow();
    });

    it('converts a foreign-currency bill in the right direction', async () => {
      await dataSource.getRepository(ExchangeRate).save({
        fromCurrency: 'USD',
        toCurrency: 'DOP',
        rate: 58.75,
        date: new Date('2026-03-01T00:00:00.000Z'),
      });

      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-05' as unknown as Date,
          dueDate: '2026-04-04' as unknown as Date,
          currencyCode: 'USD',
          lines: [{ product: 'Licencias', quantity: 1, unitPrice: 100 }],
        } as CreateVendorBillDto,
        organizationId,
      );

      // 100 USD at 58.75 DOP per USD is 5,875 DOP. The old code fetched a DOP→USD rate and
      // multiplied, recording roughly 1.70.
      expect(bill.total).toBe(100);
      expect(bill.totalInBaseCurrency).toBe(5875);
      expect(bill.exchangeRate).toBeCloseTo(58.75, 6);
    });
  });

  describe('posting an approved bill', () => {
    const billWithTax = async () =>
      payables.create(
        {
          vendorId,
          date: '2026-03-10' as unknown as Date,
          dueDate: '2026-04-09' as unknown as Date,
          lines: [
            {
              product: 'Consultoría',
              quantity: 1,
              unitPrice: 10_000,
              expenseAccountId: account['expense'],
            },
          ],
          // ITBIS 18% borne, 30% of it withheld, plus 10% ISR withheld on the service.
          taxAmount: 1_800,
          taxWithheld: 540,
          incomeTaxWithheld: 1_000,
        } as CreateVendorBillDto,
        organizationId,
      );

    it('books the tax and the withholdings, not just the expense', async () => {
      const bill = await billWithTax();
      await payables.submitForApproval(bill.id, organizationId, ACTOR);

      expect(await signedBalance('expense')).toBe(10_000);
      // Deductible tax is an asset against the return. The old entry had no tax line at all.
      expect(await signedBalance('taxReceivable')).toBe(1_800);
      // Withheld from the supplier and owed to the authority: a credit balance, so negative.
      expect(await signedBalance('withholding')).toBe(-1_540);
      // The supplier is owed the document total less what was withheld from them.
      expect(await signedBalance('payable')).toBe(-(11_800 - 1_540));
    });

    it('leaves the bill open for exactly what the supplier is owed', async () => {
      const bill = await billWithTax();
      const posted = await payables.submitForApproval(bill.id, organizationId, ACTOR);

      expect(posted.status).toBe(VendorBillStatus.OPEN);
      expect(posted.balance).toBe(10_260);
    });
  });

  describe('paying', () => {
    it('settles part of a bill and leaves the rest open', async () => {
      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-10' as unknown as Date,
          dueDate: '2026-04-09' as unknown as Date,
          lines: [
            { product: 'Alquiler', quantity: 1, unitPrice: 20_000, expenseAccountId: account['expense'] },
          ],
        } as CreateVendorBillDto,
        organizationId,
      );
      await payables.submitForApproval(bill.id, organizationId, ACTOR);

      await payables.payBills(
        {
          paymentDate: '2026-03-20',
          bankAccountId,
          lines: [{ vendorBillId: bill.id, amount: 8_000 }],
        },
        organizationId,
        ACTOR,
      );

      const after = await payables.findOne(bill.id, organizationId);
      expect(after.status).toBe(VendorBillStatus.PARTIALLY_PAID);
      expect(after.balance).toBe(12_000);
      expect(await signedBalance('bank')).toBe(-8_000);
      expect(await signedBalance('payable')).toBe(-12_000);
    });

    it('withholds at payment and credits the authority', async () => {
      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-10' as unknown as Date,
          dueDate: '2026-04-09' as unknown as Date,
          lines: [
            { product: 'Honorarios', quantity: 1, unitPrice: 10_000, expenseAccountId: account['expense'] },
          ],
        } as CreateVendorBillDto,
        organizationId,
      );
      await payables.submitForApproval(bill.id, organizationId, ACTOR);

      await payables.payBills(
        {
          paymentDate: '2026-03-25',
          bankAccountId,
          lines: [
            { vendorBillId: bill.id, amount: 9_000, incomeTaxWithheld: 1_000 },
          ],
        },
        organizationId,
        ACTOR,
      );

      const after = await payables.findOne(bill.id, organizationId);
      expect(after.status).toBe(VendorBillStatus.PAID);
      expect(after.balance).toBe(0);
      // 9,000 left the bank; 1,000 is now owed to the tax authority.
      expect(await signedBalance('bank')).toBe(-9_000);
      expect(await signedBalance('withholding')).toBe(-1_000);
      expect(await signedBalance('payable')).toBe(0);
    });

    it('books the realised exchange difference when the rate has moved', async () => {
      const rates = dataSource.getRepository(ExchangeRate);
      await rates.save({
        fromCurrency: 'USD',
        toCurrency: 'DOP',
        rate: 58,
        date: new Date('2026-03-01T00:00:00.000Z'),
      });

      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-10' as unknown as Date,
          dueDate: '2026-04-09' as unknown as Date,
          currencyCode: 'USD',
          lines: [
            { product: 'Importación', quantity: 1, unitPrice: 1_000, expenseAccountId: account['expense'] },
          ],
        } as CreateVendorBillDto,
        organizationId,
      );
      await payables.submitForApproval(bill.id, organizationId, ACTOR);
      expect(await signedBalance('payable')).toBe(-58_000);

      // The peso weakens before the invoice is settled.
      await rates.save({
        fromCurrency: 'USD',
        toCurrency: 'DOP',
        rate: 60,
        date: new Date('2026-04-10T00:00:00.000Z'),
      });

      await payables.payBills(
        {
          paymentDate: '2026-04-15',
          bankAccountId,
          lines: [{ vendorBillId: bill.id, amount: 1_000 }],
        },
        organizationId,
        ACTOR,
      );

      // 60,000 left the bank to clear a 58,000 liability: a 2,000 loss, which is a debit to the
      // exchange difference account. Nothing recorded this before, so payables never cleared.
      expect(await signedBalance('bank')).toBe(-60_000);
      expect(await signedBalance('payable')).toBe(0);
      expect(await signedBalance('forex')).toBe(2_000);
    });

    it('refuses to settle more than the outstanding balance', async () => {
      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-10' as unknown as Date,
          dueDate: '2026-04-09' as unknown as Date,
          lines: [
            { product: 'Servicio', quantity: 1, unitPrice: 1_000, expenseAccountId: account['expense'] },
          ],
        } as CreateVendorBillDto,
        organizationId,
      );
      await payables.submitForApproval(bill.id, organizationId, ACTOR);

      await expect(
        payables.payBills(
          {
            paymentDate: '2026-03-20',
            bankAccountId,
            lines: [{ vendorBillId: bill.id, amount: 5_000 }],
          },
          organizationId,
          ACTOR,
        ),
      ).rejects.toThrow();
    });
  });

  describe('ageing', () => {
    it('buckets what is owed by how overdue it is', async () => {
      const open = async (dueDate: string, amount: number) => {
        const bill = await payables.create(
          {
            vendorId,
            date: '2026-03-01' as unknown as Date,
            dueDate: dueDate as unknown as Date,
            lines: [
              { product: 'Insumos', quantity: 1, unitPrice: amount, expenseAccountId: account['expense'] },
            ],
          } as CreateVendorBillDto,
          organizationId,
        );
        await payables.submitForApproval(bill.id, organizationId, ACTOR);
      };

      await open('2026-04-30', 1_000); // not yet due at the cut-off
      await open('2026-04-10', 2_000); // 5 days overdue
      await open('2026-02-01', 3_000); // 73 days overdue

      const aging = await payables.aging(organizationId, '2026-04-15');
      const row = aging.rows.find((candidate) => candidate.partyId === vendorId);

      expect(row?.current).toBe(1_000);
      expect(row?.buckets.find((bucket) => bucket.label === '1-30')?.amount).toBe(2_000);
      expect(row?.buckets.find((bucket) => bucket.label === '61-90')?.amount).toBe(3_000);
      expect(aging.totals.total).toBe(6_000);
    });
  });
});
