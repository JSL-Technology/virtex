import { DataSource } from 'typeorm';
import { OrgSettingsService } from '../organizations/services/org-settings.service';
import { AfterCommitService } from '../shared/after-commit/after-commit.service';
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
import { testExchangeRateResolver } from '../currencies/exchange-rate-resolver.testing';
import { AccountsPayableService } from './accounts-payable.service';
import { VendorBill, VendorBillStatus } from './entities/vendor-bill.entity';
import { CreateVendorBillDto } from './dto/create-vendor-bill.dto';
import {
  BankAccount,
  BankAccountType,
} from '../treasury/entities/bank-account.entity';
import { WithholdingResolverService } from '../invoices/services/withholding-resolver.service';
import { TaxpayerType } from '../localization/fiscal/withholding-regimes';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { I18nService } from '../i18n/i18n.service';
import { VendorDebitNotesService } from './vendor-debit-notes.service';
import { VendorDebitNote, VendorDebitNoteStatus } from './entities/vendor-debit-note.entity';
import { VendorPaymentsService } from './vendor-payments.service';
import { SupplierStatementService } from './supplier-statement.service';
import { PaymentBatch, PaymentBatchStatus } from './entities/payment-batch.entity';

/**
 * Supplier invoices, from recording to settlement.
 *
 * The two assertions that matter most here are the ones the audit found missing entirely: that the
 * tax and withholding a bill describes reach the ledger, and that paying a foreign-currency bill at
 * a different rate books the realised exchange difference instead of leaving payables unclearable.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

/**
 * The foreign currency this suite publishes rates for.
 *
 * Rates are not tenant-scoped — what a currency was worth on a day is a fact about the market —
 * so the `exchange_rate` table is shared by every suite Jest runs in parallel. Each suite that
 * publishes rates therefore owns a pair of its own: payables EUR→DOP, receipts GBP→DOP, treasury
 * USD→DOP. Two suites writing the same pair for the same day either collide on
 * `UQ_exchange_rate_pair_date_type` or, worse, overwrite one another's rate and change the other's
 * expected figures — which is exactly what made these three fail intermittently.
 */
const FOREIGN = 'EUR';

describeWithDb('accounts payable', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let payables: AccountsPayableService;
  let debitNotes: VendorDebitNotesService;
  let vendorPayments: VendorPaymentsService;
  let balances: AccountBalancesService;

  let organizationId: string;
  let ledgerId: string;
  let vendorId: string;
  /** A persona física supplier, used by the tests that are about withholding. */
  let individualVendorId: string;
  let inventory: { receiveGoods: jest.Mock; returnGoods: jest.Mock; absorbReceivedCostDifference: jest.Mock };
  let eventBus: EventEmitter2;
  const account: Record<string, string> = {};
  let bankAccountId: string;

  const ACTOR = '22222222-2222-4222-8222-222222222222';
  // A real catalogue product of the test tenant, seeded per test: the bill reads its kind.
  let PRODUCT_ID: string;

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
    // A recording stub rather than a no-op: the direction of the stock movement is the defect
    // under test. Approving a purchase never increased stock and annulling one increased it, so
    // every annulment added goods that had never arrived.
    inventory = {
      // Receiving goes through the same port a purchase-order receipt uses (QA C-07): stock in,
      // cost re-averaged, a stock-ledger line — and no second entry, since the bill booked it.
      receiveGoods: jest.fn().mockResolvedValue({ journalEntryId: null, stocked: [true], warehouseId: null }),
      returnGoods: jest.fn().mockResolvedValue(null),
      absorbReceivedCostDifference: jest.fn().mockResolvedValue({ absorbed: 0, units: 0 }),
    };

    //  Stock moves in the bill's own transaction through `GoodsReceiptPort` (AP-05); the events
    //  that follow the commit are business facts for the workflow engine, not the stock path.
    eventBus = new EventEmitter2();
    const afterCommit = new AfterCommitService(dataSource);
    afterCommit.onModuleInit();
    balances = new AccountBalancesService(dataSource);
    const entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null), announcePending: jest.fn() } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      audit,
      testExchangeRateResolver(dataSource),
    );

    payables = new AccountsPayableService(
      dataSource.getRepository(VendorBill),
      // El servicio, no el repositorio: la lectura de los ajustes del inquilino tiene dueño desde
      // la separación modular, y pasarle el repositorio ya no compila.
      new OrgSettingsService(dataSource.getRepository(OrganizationSettings)),
      entries,
      dataSource,
      eventBus,
      // El inventario salió de la firma —`AccountsPayable` dejó de llamarlo y pasó a publicar un
      // evento post-commit (B-14)— y en su lugar entró `AfterCommitService`, que es quien espera
      // al commit antes de publicarlo. El spec seguía pasando el doble de inventario en la
      // posición del DataSource.
      afterCommit,
      { startApprovalProcess: jest.fn().mockResolvedValue(null), announcePending: jest.fn() } as never,
      { checkBudget: jest.fn().mockResolvedValue({ isExceeded: false }) } as never,
      testExchangeRateResolver(dataSource),
      balances,
      // The real resolver, not a stub: what is withheld from a supplier follows from the
      // supplier's fiscal classification and the tenant's country, and a stub would let the tests
      // agree with a rule the product does not actually apply.
      new WithholdingResolverService(),
      // The real narrative service, so the assertions read the sentences the ledger will actually
      // carry rather than a stub's.
      new LedgerNarrativeService(new I18nService()),
      inventory as never,
    );

    debitNotes = new VendorDebitNotesService(
      dataSource.getRepository(VendorDebitNote),
      dataSource,
      entries,
      new LedgerNarrativeService(new I18nService()),
      // The two lookups, answered from the tenant's own rows: the spec seeds one default ledger and
      // the COMPRAS journal, which is all the note asks them for.
      {
        requireDefault: (org: string, manager = dataSource.manager) =>
          manager.findOneOrFail(Ledger, { where: { organizationId: org, isDefault: true } }),
      } as never,
      {
        requireByCode: (org: string, code: string, manager = dataSource.manager) =>
          manager.findOneOrFail(Journal, { where: { organizationId: org, code } }),
      } as never,
      new OrgSettingsService(dataSource.getRepository(OrganizationSettings)),
    );

    vendorPayments = new VendorPaymentsService(dataSource.getRepository(PaymentBatch), dataSource, entries);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `AP ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
        // The tenant's country is what selects the withholding scheme. Without it the product
        // applies nothing, which is correct behaviour and makes this a suite about a tenant in no
        // country at all.
        country: 'DO',
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
    await make('inventory', '1140', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.INVENTORY);
    await make('forex', '5901', AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, AccountNature.DEBIT, AccountRole.FOREX_GAIN_LOSS);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({
        organizationId,
        baseCurrency: 'DOP',
        defaultAccountsPayableId: account['payable'],
        defaultForexGainLossAccountId: account['forex'],
        defaultInventoryId: account['inventory'],
      }),
    );

    await dataSource.getRepository(AccountingPeriod).save([
      { organizationId, name: 'Marzo 2026', startDate: '2026-03-01', endDate: '2026-03-31', status: PeriodStatus.OPEN },
      { organizationId, name: 'Abril 2026', startDate: '2026-04-01', endDate: '2026-04-30', status: PeriodStatus.OPEN },
      // An annulment with no stated date books today, and a posting into a date that belongs to no
      // period is refused — correctly. The tenant therefore needs a period covering now, which is
      // also true of any real deployment: a calendar that stops in the past stops the product.
      {
        organizationId,
        name: 'Período actual',
        startDate: `${new Date().getUTCFullYear()}-01-01` as unknown as Date,
        endDate: `${new Date().getUTCFullYear()}-12-31` as unknown as Date,
        status: PeriodStatus.OPEN,
      },
    ]);

    // Two suppliers, because what is withheld on a purchase follows from who the supplier is.
    //
    // The ordinary one is a company: buying from a company withholds nothing, which is the case
    // every test here that is not about withholding wants to be looking at.
    const vendor = await dataSource.getRepository(Supplier).save(
      dataSource.getRepository(Supplier).create({
        organizationId,
        name: 'Suplidora del Caribe',
        country: 'DO',
        taxpayerType: TaxpayerType.COMPANY,
      }),
    );
    vendorId = vendor.id;

    [{ id: PRODUCT_ID }] = await dataSource.query(
      `INSERT INTO "products" ("organization_id", "name", "kind") VALUES ($1, 'Mercancía de prueba', 'GOOD') RETURNING id`,
      [organizationId],
    );

    // The second is a persona física. Buying a service from one is the case the DGII's two
    // regimes cover — 100 % of the ITBIS (Norma General 02-05) and 10 % of the fee (art. 309) —
    // and it is what the withholding tests use.
    const individual = await dataSource.getRepository(Supplier).save(
      dataSource.getRepository(Supplier).create({
        organizationId,
        name: 'Ing. Pérez (persona física)',
        country: 'DO',
        taxpayerType: TaxpayerType.INDIVIDUAL,
      }),
    );
    individualVendorId = individual.id;

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
      .delete({ id: organizationId });
    // Rates are deliberately not tenant-scoped — what a currency was worth on a day is a fact
    // about the market — so they outlive the tenant and have to be cleared between tests.
    //
    // Jest runs suites in parallel workers against one database, and the rate table is the one
    // piece of state they share. Two things follow, and both are enforced here. The pair this
    // suite publishes is its own — payables uses EUR, receipts GBP, treasury USD — because a
    // second suite writing EUR→DOP for the same day would either collide on
    // `UQ_exchange_rate_pair_date_type` or, worse, overwrite this suite's rate and change its
    // arithmetic. And the delete is scoped to that pair rather than clearing the table, which is
    // what used to make the consolidation and exchange-rate suites fail with "no rate found" for
    // pairs they had just inserted.
    //
    // Raw DELETE, not `repository.delete({})`: TypeORM rejects empty criteria outright, and a
    // swallowed rejection here leaves a stale rate that quietly changes the next test's arithmetic.
    await dataSource.query(
      'DELETE FROM "exchange_rate" WHERE "fromCurrency" = $1 AND "toCurrency" = $2',
      [FOREIGN, 'DOP'],
    );
  });

  const signedBalance = async (key: string, asOf = '2026-04-30') =>
    (await balances.balancesAsOf({ organizationId, ledgerId, asOf })).get(account[key]) ?? 0;

  describe('recording', () => {
    it('recomputes the total from the lines rather than trusting the caller', async () => {
      await expect(
        payables.create(
          {
            vendorId,
            date: '2026-03-05',
            dueDate: '2026-04-04',
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
        fromCurrency: FOREIGN,
        toCurrency: 'DOP',
        rate: 58.75,
        date: new Date('2026-03-01T00:00:00.000Z'),
      });

      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-05',
          dueDate: '2026-04-04',
          currencyCode: FOREIGN,
          lines: [{ product: 'Licencias', quantity: 1, unitPrice: 100 }],
        } as CreateVendorBillDto,
        organizationId,
      );

      // 100 EUR at 58.75 DOP per EUR is 5,875 DOP. The old code fetched a DOP→EUR rate and
      // multiplied, recording roughly 1.70.
      expect(bill.total).toBe(100);
      expect(bill.totalInBaseCurrency).toBe(5875);
      expect(bill.exchangeRate).toBeCloseTo(58.75, 6);
    });
  });

  /**
   * AP-02 (audit 2026-10-31): a bill that did not split its base sent the WHOLE subtotal to
   * services — and the bill form never split it — so every purchase of goods was reported in the
   * 606 as services and withheld ISR it did not owe.
   */
  describe('goods and services', () => {
    const goodsFromIndividual = (extra: Partial<CreateVendorBillDto> = {}) =>
      payables.create(
        {
          vendorId: individualVendorId,
          date: '2026-03-10',
          dueDate: '2026-04-09',
          lines: [
            { product: 'Mercancía', quantity: 2, unitPrice: 3_000, productId: PRODUCT_ID },
            { product: 'Instalación', quantity: 1, unitPrice: 1_000, expenseAccountId: account['expense'] },
          ],
          taxAmount: 1_260,
          ...extra,
        } as CreateVendorBillDto,
        organizationId,
      );

    it('takes the split from the lines: a catalogue good is goods, a free expense line a service', async () => {
      const bill = await goodsFromIndividual();
      expect(bill.goodsAmount).toBe(6_000);
      expect(bill.servicesAmount).toBe(1_000);
      // ISR is withheld on the service only: 10 % of 1,000, not of 7,000.
      expect(bill.incomeTaxWithheld).toBe(100);
      const natures = await dataSource.query(
        `SELECT product, nature FROM vendor_bill_line WHERE "vendorBillId" = $1 ORDER BY product`,
        [bill.id],
      );
      expect(natures).toEqual([
        { product: 'Instalación', nature: 'SERVICES' },
        { product: 'Mercancía', nature: 'GOODS' },
      ]);
    });

    it('withholds no ISR on a bill that buys only goods', async () => {
      const bill = await payables.create(
        {
          vendorId: individualVendorId,
          date: '2026-03-10',
          dueDate: '2026-04-09',
          lines: [{ product: 'Mercancía', quantity: 1, unitPrice: 5_000, productId: PRODUCT_ID }],
        } as CreateVendorBillDto,
        organizationId,
      );
      expect(bill.goodsAmount).toBe(5_000);
      expect(bill.servicesAmount).toBe(0);
      expect(bill.incomeTaxWithheld).toBe(0);
    });

    it('lets a line state its nature over the product kind', async () => {
      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-10',
          dueDate: '2026-04-09',
          lines: [
            { product: 'Mantenimiento del equipo', quantity: 1, unitPrice: 2_000, productId: PRODUCT_ID, nature: 'SERVICES' },
            { product: 'Repuestos', quantity: 1, unitPrice: 500, expenseAccountId: account['expense'], nature: 'GOODS' },
          ],
        } as CreateVendorBillDto,
        organizationId,
      );
      expect(bill.servicesAmount).toBe(2_000);
      expect(bill.goodsAmount).toBe(500);
    });

    it('refuses a stated split that does not add up to the subtotal', async () => {
      await expect(goodsFromIndividual({ goodsAmount: 1_000, servicesAmount: 1_000 })).rejects.toMatchObject({
        messageKey: 'accounts_payable.base_split_does_not_add_up',
      });
      // One side alone takes the rest of the subtotal as the other.
      const bill = await goodsFromIndividual({ servicesAmount: 7_000 });
      expect(bill.goodsAmount).toBe(0);
    });

    it('refuses a product the tenant does not have', async () => {
      await expect(
        payables.create(
          {
            vendorId,
            date: '2026-03-10',
            dueDate: '2026-04-09',
            lines: [{ product: 'Ajeno', quantity: 1, unitPrice: 1, productId: '33333333-3333-4333-8333-333333333333' }],
          } as CreateVendorBillDto,
          organizationId,
        ),
      ).rejects.toMatchObject({ messageKey: 'common.referenced_record_not_found' });
    });

    it('does not let an edit change the split apart from the lines', async () => {
      const bill = await goodsFromIndividual();
      await expect(
        payables.update(bill.id, { servicesAmount: 7_000 }, organizationId),
      ).rejects.toMatchObject({ messageKey: 'accounts_payable.base_split_follows_lines' });
    });
  });

  /**
   * AP-03 (audit 2026-10-31): only the Dominican NCF identified a supplier document, so two
   * identical POSTs without one both succeeded — the same invoice recorded, and payable, twice.
   */
  describe('the same supplier document twice', () => {
    const bill = (extra: Partial<CreateVendorBillDto> = {}) =>
      payables.create(
        {
          vendorId,
          date: '2026-03-12',
          dueDate: '2026-04-11',
          lines: [{ product: 'Servicio', quantity: 1, unitPrice: 4_000, expenseAccountId: account['expense'] }],
          ...extra,
        } as CreateVendorBillDto,
        organizationId,
      );

    it('refuses a supplier number already recorded for that supplier, however it is typed', async () => {
      const first = await bill({ supplierInvoiceNumber: 'FAC-000123' });
      expect(first.supplierInvoiceNumber).toBe('FAC-000123');
      await expect(bill({ supplierInvoiceNumber: 'fac 123', date: '2026-03-20' })).rejects.toMatchObject({
        messageKey: 'accounts_payable.supplier_invoice_already_recorded',
      });
      // Another supplier may use the same number.
      await expect(
        bill({ supplierInvoiceNumber: 'FAC-000123', vendorId: individualVendorId }),
      ).resolves.toBeDefined();
    });

    it('lets the number be used again once the bill carrying it is voided', async () => {
      const first = await bill({ supplierInvoiceNumber: 'FAC-77' });
      await payables.voidBill(first.id, organizationId, { reason: 'Registrada por error' }, ACTOR);
      await expect(bill({ supplierInvoiceNumber: 'FAC-77' })).resolves.toBeDefined();
    });

    it('enforces it in the database, not only in the service', async () => {
      await bill({ supplierInvoiceNumber: 'FAC-9' });
      await expect(
        dataSource.query(
          `INSERT INTO "vendor_bills"
             ("organization_id", "vendor_id", "date", "dueDate", "total", "balance", "status",
              "currency_code", "exchange_rate", "total_in_base_currency", "version", "supplier_invoice_key")
           VALUES ($1, $2, '2026-03-12', '2026-04-11', 1, 1, 'DRAFT', 'DOP', 1, 1, 1, 'FAC9')`,
          [organizationId, vendorId],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('takes an unnumbered bill identical to a live one for the same document, unless confirmed', async () => {
      await bill();
      await expect(bill()).rejects.toMatchObject({ messageKey: 'accounts_payable.possible_duplicate_bill' });
      // A different total, or a confirmation that it is another document, is recorded.
      await expect(bill({ lines: [{ product: 'Servicio', quantity: 1, unitPrice: 4_001, expenseAccountId: account['expense'] }] } as never)).resolves.toBeDefined();
      await expect(bill({ allowPossibleDuplicate: true })).resolves.toBeDefined();
    });

    it("refuses the same fiscal document twice outside the Dominican Republic too", async () => {
      // A CFDI UUID, a CUFE, a US invoice number: whatever the market calls it, one document.
      await dataSource.query(`UPDATE organizations SET country = 'US' WHERE id = $1`, [organizationId]);
      await bill({ ncf: 'inv-2026-0042' });
      await expect(bill({ ncf: 'INV 2026 0042', date: '2026-03-25' })).rejects.toMatchObject({
        messageKey: 'accounts_payable.supplier_document_already_recorded',
      });
    });

    it('refuses an edit that gives a bill a number another live bill already has', async () => {
      await bill({ supplierInvoiceNumber: 'FAC-1' });
      const second = await bill({ supplierInvoiceNumber: 'FAC-2' });
      await expect(
        payables.update(second.id, { supplierInvoiceNumber: 'FAC-0001' }, organizationId),
      ).rejects.toMatchObject({ messageKey: 'accounts_payable.supplier_invoice_already_recorded' });
    });
  });

  describe('posting an approved bill', () => {
    const billWithTax = async () =>
      payables.create(
        {
          // A persona física: this is the case the two DGII withholding regimes cover.
          vendorId: individualVendorId,
          date: '2026-03-10',
          dueDate: '2026-04-09',
          lines: [
            {
              product: 'Consultoría',
              quantity: 1,
              unitPrice: 10_000,
              expenseAccountId: account['expense'],
            },
          ],
          // ITBIS 18 % borne. What is withheld is NOT stated here any more: the server resolves it
          // from the supplier's classification, which is the whole point — the figures used to be
          // whatever the caller sent, with nothing able to check them.
          taxAmount: 1_800,
          servicesAmount: 10_000,
        } as CreateVendorBillDto,
        organizationId,
      );

    describe("the supplier's commercial terms (CMP-17)", () => {
      const plainBill = (extra: Partial<CreateVendorBillDto> = {}) =>
        payables.create(
          {
            vendorId: individualVendorId,
            date: '2026-02-01',
            lines: [{ product: 'QA-terms', quantity: 1, unitPrice: 100 }],
            servicesAmount: 100,
            ...extra,
          } as CreateVendorBillDto,
          organizationId,
        );

      afterEach(async () => {
        await dataSource.query(
          `UPDATE suppliers SET status = 'ACTIVE', blocked_reason = NULL, payment_term_days = NULL, default_expense_account_id = NULL WHERE id = $1`,
          [individualVendorId],
        );
      });

      it('dates the bill from the payment terms and books a free line to the default expense account', async () => {
        await dataSource.query(`UPDATE suppliers SET payment_term_days = 30, default_expense_account_id = $2 WHERE id = $1`, [
          individualVendorId,
          account['expense'],
        ]);
        const bill = await plainBill();
        expect(String(bill.dueDate).slice(0, 10)).toBe('2026-03-03');
        expect(bill.lines[0].expenseAccountId).toBe(account['expense']);
      });

      it('neither bills nor pays a blocked supplier', async () => {
        await dataSource.query(`UPDATE suppliers SET status = 'BLOCKED', blocked_reason = 'QA: cuenta en disputa' WHERE id = $1`, [individualVendorId]);
        await expect(plainBill({ dueDate: '2026-03-03' } as Partial<CreateVendorBillDto>)).rejects.toMatchObject({
          messageKey: 'accounts_payable.supplier_blocked',
        });
      });
    });

    describe('the consumption tax is computed, not taken from the request (CMP-02)', () => {
      const taxed = (extra: Partial<CreateVendorBillDto>, rate?: number) =>
        payables.create(
          {
            vendorId: individualVendorId,
            date: '2026-02-01',
            dueDate: '2026-03-03',
            lines: [{ product: 'QA-servicio', quantity: 1, unitPrice: 1_000, expenseAccountId: account['expense'], ...(rate === undefined ? {} : { taxRate: rate }) }],
            servicesAmount: 1_000,
            ...extra,
          } as CreateVendorBillDto,
          organizationId,
        );

      it('computes the tax from the line rate when none is stated', async () => {
        const bill = await taxed({}, 0.18);
        expect(bill.taxAmount).toBe(180);
        const [line] = await dataSource.query(`SELECT tax_rate FROM vendor_bill_line WHERE "vendorBillId" = $1`, [bill.id]);
        expect(Number(line.tax_rate)).toBe(0.18);
      });

      it('refuses 900 of ITBIS on 1,000 — the audit case — without a reason', async () => {
        await expect(taxed({ taxAmount: 900 })).rejects.toMatchObject({ messageKey: 'accounts_payable.tax_amount_exceeds_highest_rate' });
        await expect(taxed({ taxAmount: 900 }, 0.18)).rejects.toMatchObject({ messageKey: 'accounts_payable.tax_amount_differs_from_lines' });
      });

      it('refuses a line rate that is not in force on the bill date', async () => {
        await expect(taxed({}, 0.17)).rejects.toMatchObject({ messageKey: 'accounts_payable.line_tax_rate_not_in_force' });
      });

      it("keeps the supplier's figure within a cent of rounding, and a larger one only with a recorded reason", async () => {
        expect((await taxed({ taxAmount: 180.01 }, 0.18)).taxAmount).toBe(180.01);
        const justified = await taxed({ taxAmount: 200, taxOverrideReason: 'QA: el proveedor facturó ITBIS sobre un cargo no desglosado' }, 0.18);
        expect(justified.taxAmount).toBe(200);
        expect(justified.taxOverrideReason).toContain('QA:');
      });
    });

    it('books the tax and the withholdings, not just the expense', async () => {
      const bill = await billWithTax();
      await payables.submitForApproval(bill.id, organizationId, ACTOR);

      // The two regimes the supplier's classification produces, and nothing the caller chose.
      expect(bill.withholdingRegimeCodes).toEqual(['DO-ITBIS-100-PF', 'DO-ISR-10-SERV-PF']);
      expect(bill.taxWithheld).toBe(1_800);
      expect(bill.incomeTaxWithheld).toBe(1_000);

      expect(await signedBalance('expense')).toBe(10_000);
      // Deductible tax is an asset against the return. The old entry had no tax line at all.
      expect(await signedBalance('taxReceivable')).toBe(1_800);
      // Withheld from the supplier and owed to the authority: a credit balance, so negative.
      expect(await signedBalance('withholding')).toBe(-2_800);
      // The supplier is owed the document total less what was withheld from them.
      expect(await signedBalance('payable')).toBe(-(11_800 - 2_800));
    });

    it("refuses a withholding the supplier's regime does not produce, unless it is justified", async () => {
      const stated = () =>
        payables.create(
          {
            vendorId: individualVendorId,
            date: '2026-02-01',
            dueDate: '2026-03-03',
            lines: [
              {
                product: 'Servicios profesionales',
                quantity: 1,
                unitPrice: 10_000,
                expenseAccountId: account['expense'],
              },
            ],
            taxAmount: 1_800,
            servicesAmount: 10_000,
            // 30 % of the ITBIS: a real regime, but the one for payments BY THE STATE.
            taxWithheld: 540,
          } as CreateVendorBillDto,
          organizationId,
        );

      await expect(stated()).rejects.toThrow();

      const justified = await payables.create(
        {
          vendorId: individualVendorId,
          date: '2026-02-01',
          dueDate: '2026-03-03',
          lines: [
            {
              product: 'Servicios profesionales',
              quantity: 1,
              unitPrice: 10_000,
              expenseAccountId: account['expense'],
            },
          ],
          taxAmount: 1_800,
          servicesAmount: 10_000,
          taxWithheld: 540,
          withholdingOverrideReason: 'Designación de agente de retención notificada esta semana.',
        } as CreateVendorBillDto,
        organizationId,
      );

      expect(justified.taxWithheld).toBe(540);
      // An override claims no regime: the reason is what the filing is traced to instead.
      expect(justified.withholdingRegimeCodes).toEqual([]);
      expect(justified.withholdingOverrideReason).toContain('agente de retención');
    });

    it('leaves the bill open for exactly what the supplier is owed', async () => {
      const bill = await billWithTax();
      const posted = await payables.submitForApproval(bill.id, organizationId, ACTOR);

      expect(posted.status).toBe(VendorBillStatus.OPEN);
      // 11 800 less the 2 800 withheld from the supplier under the two regimes above.
      expect(posted.balance).toBe(9_000);
    });
  });

  describe('paying', () => {
    it('settles part of a bill and leaves the rest open', async () => {
      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-10',
          dueDate: '2026-04-09',
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
          date: '2026-03-10',
          dueDate: '2026-04-09',
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
        fromCurrency: FOREIGN,
        toCurrency: 'DOP',
        rate: 58,
        date: new Date('2026-03-01T00:00:00.000Z'),
      });

      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-10',
          dueDate: '2026-04-09',
          currencyCode: FOREIGN,
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
        fromCurrency: FOREIGN,
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
          date: '2026-03-10',
          dueDate: '2026-04-09',
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
            date: '2026-03-01',
            dueDate,
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

    it('ties its total to the payables control account in the general ledger', async () => {
      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-01',
          dueDate: '2026-04-10',
          lines: [
            { product: 'Insumos', quantity: 1, unitPrice: 4_000, expenseAccountId: account['expense'] },
          ],
        } as CreateVendorBillDto,
        organizationId,
      );
      await payables.submitForApproval(bill.id, organizationId, ACTOR);

      const aging = await payables.aging(organizationId, '2026-04-15');

      // The ledger's figure is a credit balance; the report states what is owed, so the sign is
      // flipped once. The two must agree, and the report says so on the page rather than leaving
      // an auditor to export both and subtract.
      expect(await signedBalance('payable', '2026-04-15')).toBe(-4_000);
      expect(aging.controlAccountBalance).toBe(4_000);
      expect(aging.totals.total).toBe(4_000);
      expect(aging.controlAccountDifference).toBe(0);
      expect(aging.currencyCode).toBe('DOP');
      expect(aging.unconvertedDocuments).toBe(0);
    });

    it('ages a foreign-currency bill at the closing rate, not the rate it was booked at', async () => {
      const rates = dataSource.getRepository(ExchangeRate);
      await rates.save({
        fromCurrency: FOREIGN,
        toCurrency: 'DOP',
        rate: 58,
        date: new Date('2026-03-01T00:00:00.000Z'),
      });

      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-05',
          dueDate: '2026-04-10',
          currencyCode: FOREIGN,
          lines: [
            { product: 'Importación', quantity: 1, unitPrice: 1_000, expenseAccountId: account['expense'] },
          ],
        } as CreateVendorBillDto,
        organizationId,
      );
      await payables.submitForApproval(bill.id, organizationId, ACTOR);

      // The peso weakens between the invoice and the reporting date.
      await rates.save({
        fromCurrency: FOREIGN,
        toCurrency: 'DOP',
        rate: 62,
        date: new Date('2026-04-10T00:00:00.000Z'),
      });

      const aging = await payables.aging(organizationId, '2026-04-15');

      // 1,000 at the closing rate of 62, not at the 58 it was booked at. The period-end
      // revaluation restates the control account to the closing rate, so ageing at the booked
      // rate drifted from it a little further after every close with nothing reporting the gap.
      expect(aging.totals.total).toBe(62_000);
      expect(aging.unconvertedDocuments).toBe(0);
    });

    it('counts the documents it could not restate instead of passing them off as converted', async () => {
      // Written directly. `create` refuses a currency with no rate on file for the document's own
      // date, and what is under test is the report's behaviour towards a bill already in the books
      // whose currency has no quote on the REPORTING date — a weekend, a holiday, a feed that has
      // not published yet. Every one of those is an ordinary Tuesday in production.
      await dataSource.query(
        `INSERT INTO "vendor_bills"
           ("organization_id", "vendor_id", "date", "dueDate", "total", "balance", "status",
            "currency_code", "exchange_rate", "total_in_base_currency", "version")
         VALUES ($1, $2, '2026-03-05', '2026-04-10', 1000, 1000, 'OPEN', $3, 58, 58000, 1)`,
        [organizationId, vendorId, FOREIGN],
      );

      const aging = await payables.aging(organizationId, '2026-04-15');

      // Held at the rate it was booked at, and said so. Converting it at 1, or dropping it from
      // the report, are both ways of stating a total nobody can substantiate.
      expect(aging.totals.total).toBe(58_000);
      expect(aging.unconvertedDocuments).toBe(1);
    });
  });

  describe('annulment', () => {
    const openBill = async (options: { withProduct?: boolean } = {}) => {
      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-05',
          dueDate: '2026-04-04',
          lines: [
            {
              product: 'Mercancía',
              quantity: 4,
              unitPrice: 2_500,
              total: 10_000,
              ...(options.withProduct
                ? { productId: PRODUCT_ID }
                : { expenseAccountId: account['expense'] }),
            },
          ],
          taxAmount: 1_800,
        } as CreateVendorBillDto,
        organizationId,
      );
      return payables.submitForApproval(bill.id, organizationId, ACTOR);
    };

    /**
     * A debit note is a posted document (lifecycle audit).
     *
     * It could be edited after posting — a new amount left its entry and the bill's balance saying
     * the old one — or deleted, leaving its entry in the ledger for a note that no longer existed,
     * and its "void" was a stub that refused. Now it is corrected only by voiding.
     */
    describe('debit notes', () => {
      const LATER = '2026-12-31';

      it('reduces what is owed, and a void gives it back and reverses the entry', async () => {
        const bill = await openBill();
        const note = await debitNotes.create(
          { vendorBillId: bill.id, reason: 'Mercancía defectuosa', amount: 1_000, expenseAccountId: account['expense'] },
          organizationId,
        );
        expect(note.status).toBe(VendorDebitNoteStatus.POSTED);
        expect(note.journalEntryId).toEqual(expect.any(String));
        expect((await dataSource.getRepository(VendorBill).findOneByOrFail({ id: bill.id })).balance).toBe(10_800);
        expect(await signedBalance('payable', LATER)).toBe(-10_800);

        const voided = await debitNotes.voidNote(note.id, organizationId, { reason: 'Emitida por error' }, ACTOR);

        expect(voided.status).toBe(VendorDebitNoteStatus.VOIDED);
        expect(voided.reversalJournalEntryId).toEqual(expect.any(String));
        expect(voided.voidedByUserId).toBe(ACTOR);
        const restored = await dataSource.getRepository(VendorBill).findOneByOrFail({ id: bill.id });
        expect(restored.balance).toBe(11_800);
        expect(restored.status).toBe(VendorBillStatus.OPEN);
        expect(await signedBalance('payable', LATER)).toBe(-11_800);
      });

      it('settles the bill when the note takes it to zero', async () => {
        const bill = await openBill();
        await debitNotes.create(
          { vendorBillId: bill.id, reason: 'Devolución total', amount: 11_800, expenseAccountId: account['expense'] },
          organizationId,
        );
        const settled = await dataSource.getRepository(VendorBill).findOneByOrFail({ id: bill.id });
        expect(settled.balance).toBe(0);
        // It used to stay OPEN owing nothing, and kept appearing among the bills to pay.
        expect(settled.status).toBe(VendorBillStatus.PAID);
      });

      it('is neither edited nor deleted once posted, and is voided only once', async () => {
        const bill = await openBill();
        const note = await debitNotes.create(
          { vendorBillId: bill.id, reason: 'Ajuste de precio', amount: 500, expenseAccountId: account['expense'] },
          organizationId,
        );

        await expect(debitNotes.update(note.id, { amount: 50 }, organizationId)).rejects.toMatchObject({
          messageKey: 'accounts_payable.debit_note_posted_is_immutable',
        });
        await expect(debitNotes.remove(note.id, organizationId)).rejects.toMatchObject({
          messageKey: 'accounts_payable.debit_note_delete_use_void',
        });

        await debitNotes.voidNote(note.id, organizationId, { reason: 'Duplicada' }, ACTOR);
        await expect(
          debitNotes.voidNote(note.id, organizationId, { reason: 'Otra vez' }, ACTOR),
        ).rejects.toMatchObject({ messageKey: 'accounts_payable.debit_note_already_voided' });
      });
    });

    it('reverses the journal entry instead of leaving the debt in the ledger', async () => {
      const bill = await openBill();
      expect(await signedBalance('payable')).toBe(-11_800);

      // Dated inside April so the assertion's cut-off sees both the bill and its reversal. An
      // annulment with no date books today, which is what the other cases exercise.
      await payables.voidBill(
        bill.id,
        organizationId,
        { reason: 'Duplicada', reversalDate: '2026-04-20' },
        ACTOR,
      );

      // The payable and the expense are both back to zero. Before, they stayed for good: the
      // subledger said VOID and the general ledger said owed, permanently, and no report compared
      // the two.
      expect(await signedBalance('payable')).toBe(0);
      expect(await signedBalance('expense')).toBe(0);
      expect(await signedBalance('taxReceivable')).toBe(0);
    });

    it('records the reversal, the reason, the time and the author on the document', async () => {
      const bill = await openBill();
      const voided = await payables.voidBill(
        bill.id,
        organizationId,
        { reason: 'Recibida por duplicado' },
        ACTOR,
      );

      expect(voided.status).toBe(VendorBillStatus.VOID);
      expect(voided.balance).toBe(0);
      expect(voided.voidReason).toBe('Recibida por duplicado');
      expect(voided.voidedByUserId).toBe(ACTOR);
      expect(voided.voidedAt).toBeInstanceOf(Date);
      expect(voided.reversalJournalEntryId).toEqual(expect.any(String));
    });

    it('receives goods on approval and returns them on annulment', async () => {
      inventory.receiveGoods.mockClear();
      inventory.returnGoods.mockClear();

      const bill = await openBill({ withProduct: true });
      // Approving a purchase receives the goods. Nothing did this: the ledger debited inventory
      // and the subledger never moved.
      expect(inventory.receiveGoods).toHaveBeenCalledWith(
        expect.anything(),
        organizationId,
        expect.objectContaining({
          sourceType: 'vendor_bill',
          sourceId: bill.id,
          post: false,
          lines: [expect.objectContaining({ productId: PRODUCT_ID, quantity: 4 })],
        }),
        // Who approved it: the stock ledger says who received the goods.
        ACTOR,
      );

      await payables.voidBill(bill.id, organizationId, { reason: 'Devuelta al proveedor' }, ACTOR);

      // And annulling returns them, at the cost they came in at and without a second entry (the
      // reversal of the bill gives the value back). It used to *increase* stock here, so every
      // annulment added goods that had never arrived.
      expect(inventory.returnGoods).toHaveBeenCalledWith(
        expect.anything(),
        organizationId,
        expect.objectContaining({
          sourceType: 'vendor_bill_void',
          sourceId: bill.id,
          posted: false,
          lines: [expect.objectContaining({ productId: PRODUCT_ID, quantity: 4, unitCost: 2_500 })],
        }),
        ACTOR,
      );
    });

    /**
     * AP-05: the goods used to arrive after the commit, from an event handler whose failure was a
     * log line — leaving a posted entry with no stock behind it. Now they arrive in the bill's
     * own transaction, so a receipt that fails takes the posting with it.
     */
    it('posts nothing when the goods cannot be received', async () => {
      inventory.receiveGoods.mockRejectedValueOnce(new Error('almacén no disponible'));
      await expect(openBill({ withProduct: true })).rejects.toThrow('almacén no disponible');
      const [row] = await dataSource.query(
        `SELECT count(*)::int AS posted FROM vendor_bills WHERE organization_id = $1 AND journal_entry_id IS NOT NULL`,
        [organizationId],
      );
      expect(row.posted).toBe(0);
      expect(await signedBalance('payable')).toBe(0);
    });

    it('refuses to annul a bill that has been paid against', async () => {
      const bill = await openBill();
      await payables.payBills(
        {
          paymentDate: '2026-04-10',
          bankAccountId,
          lines: [{ vendorBillId: bill.id, amount: 5_000 }],
        } as never,
        organizationId,
        ACTOR,
      );

      await expect(
        payables.voidBill(bill.id, organizationId, { reason: 'Ya no aplica' }, ACTOR),
      ).rejects.toThrow();
    });

    it('refuses to annul the same bill twice', async () => {
      const bill = await openBill();
      await payables.voidBill(bill.id, organizationId, { reason: 'Duplicada' }, ACTOR);
      await expect(
        payables.voidBill(bill.id, organizationId, { reason: 'Duplicada otra vez' }, ACTOR),
      ).rejects.toThrow();
    });

    it('books the reversal on the date the caller states', async () => {
      const bill = await openBill();
      const voided = await payables.voidBill(
        bill.id,
        organizationId,
        { reason: 'Corrección de cierre', reversalDate: '2026-03-31' },
        ACTOR,
      );

      const reversal = await dataSource
        .getRepository(JournalEntry)
        .findOneByOrFail({ id: voided.reversalJournalEntryId as string });
      expect(String(reversal.date).slice(0, 10)).toBe('2026-03-31');
    });
  });

  /**
   * Payments as documents (audit H-14): a number, a list, and a void that gives every bill back
   * what the payment settled and reverses its entry.
   */
  describe('payments as documents', () => {
    const LATER = '2026-12-31';
    const billFor = async (amount: number) => {
      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-10',
          dueDate: '2026-04-09',
          lines: [{ product: 'Servicio', quantity: 1, unitPrice: amount, expenseAccountId: account['expense'] }],
        } as CreateVendorBillDto,
        organizationId,
      );
      return payables.submitForApproval(bill.id, organizationId, ACTOR);
    };

    it('is numbered and listed with what left the bank, for whom', async () => {
      const first = await billFor(20_000);
      const second = await billFor(5_000);
      const batch = await payables.payBills(
        {
          paymentDate: '2026-03-20',
          bankAccountId,
          lines: [
            { vendorBillId: first.id, amount: 8_000 },
            { vendorBillId: second.id, amount: 5_000 },
          ],
        },
        organizationId,
        ACTOR,
      );
      expect(batch.number).toBe('PAY-2026-000001');

      const page = await vendorPayments.findAll(organizationId);
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({
        number: 'PAY-2026-000001',
        paymentDate: '2026-03-20',
        status: PaymentBatchStatus.PAID,
        totalPaid: 13_000,
        billCount: 2,
        suppliers: 'Suplidora del Caribe',
        currencyCode: 'DOP',
      });
      expect((await vendorPayments.findAll(organizationId, { status: PaymentBatchStatus.VOID })).total).toBe(0);
    });

    it('voids: every bill owes again what it settled, and the entry is reversed', async () => {
      const bill = await billFor(20_000);
      const batch = await payables.payBills(
        { paymentDate: '2026-03-20', bankAccountId, lines: [{ vendorBillId: bill.id, amount: 20_000 }] },
        organizationId,
        ACTOR,
      );
      expect((await payables.findOne(bill.id, organizationId)).status).toBe(VendorBillStatus.PAID);

      const voided = await vendorPayments.voidPayment(batch.id, { reason: 'Cheque devuelto' }, organizationId, ACTOR);

      expect(voided.status).toBe(PaymentBatchStatus.VOID);
      expect(voided.reversalJournalEntryId).toEqual(expect.any(String));
      expect(voided.voidedByUserId).toBe(ACTOR);
      const restored = await payables.findOne(bill.id, organizationId);
      expect(restored.balance).toBe(20_000);
      expect(restored.status).toBe(VendorBillStatus.OPEN);
      expect(restored.paidAt).toBeNull();
      expect(await signedBalance('bank', LATER)).toBe(0);
      expect(await signedBalance('payable', LATER)).toBe(-20_000);

      await expect(
        vendorPayments.voidPayment(batch.id, { reason: 'Otra vez' }, organizationId, ACTOR),
      ).rejects.toMatchObject({ messageKey: 'accounts_payable.payment_already_voided' });
    });

    it('no longer blocks annulling the bill once the payment against it is voided', async () => {
      const bill = await billFor(3_000);
      const batch = await payables.payBills(
        { paymentDate: '2026-03-20', bankAccountId, lines: [{ vendorBillId: bill.id, amount: 1_000 }] },
        organizationId,
        ACTOR,
      );
      await expect(payables.voidBill(bill.id, organizationId, { reason: 'Duplicada' }, ACTOR)).rejects.toMatchObject({
        messageKey: 'accounts_payable.bill_with_payments_applied_cannot_voided',
      });

      await vendorPayments.voidPayment(batch.id, { reason: 'Pagada por error' }, organizationId, ACTOR);

      const voided = await payables.voidBill(bill.id, organizationId, { reason: 'Duplicada' }, ACTOR);
      expect(voided.status).toBe(VendorBillStatus.VOID);
    });
  });

  /** Debit notes carry what an issued document carries: number, date, supplier NCF, tax part. */
  describe('debit notes as documents', () => {
    const LATER = '2026-12-31';
    const taxedBill = async () => {
      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-05',
          dueDate: '2026-04-04',
          lines: [{ product: 'Mercancía', quantity: 4, unitPrice: 2_500, total: 10_000, expenseAccountId: account['expense'] }],
          taxAmount: 1_800,
        } as CreateVendorBillDto,
        organizationId,
      );
      return payables.submitForApproval(bill.id, organizationId, ACTOR);
    };

    it('is numbered, dated as stated, and gives back the tax part to the tax account', async () => {
      const bill = await taxedBill();
      expect(await signedBalance('taxReceivable', LATER)).toBe(1_800);

      const note = await debitNotes.create(
        {
          vendorBillId: bill.id,
          reason: 'Devolución de dos unidades',
          amount: 5_900,
          taxAmount: 900,
          expenseAccountId: account['expense'],
          date: '2026-04-02',
          ncf: 'b0400000001',
        },
        organizationId,
        ACTOR,
      );

      expect(note.number).toBe('ND-2026-000001');
      expect(note.date).toBe('2026-04-02');
      expect(note.ncf).toBe('B0400000001');
      expect(note.createdByUserId).toBe(ACTOR);
      expect(await signedBalance('taxReceivable', LATER)).toBe(900);
      expect(await signedBalance('expense', LATER)).toBe(5_000);
      expect(await signedBalance('payable', LATER)).toBe(-5_900);

      const page = await debitNotes.findAll(organizationId, { supplierId: vendorId });
      expect(page.items[0]).toMatchObject({ number: 'ND-2026-000001', amount: 5_900, taxAmount: 900, supplierName: 'Suplidora del Caribe' });
    });

    it('gives back no more tax than the bill claimed', async () => {
      const bill = await taxedBill();
      await expect(
        debitNotes.create(
          { vendorBillId: bill.id, reason: 'Exceso', amount: 5_000, taxAmount: 2_000, expenseAccountId: account['expense'] },
          organizationId,
          ACTOR,
        ),
      ).rejects.toMatchObject({ messageKey: 'accounts_payable.debit_note_tax_exceeds_bill_tax' });
      await expect(
        debitNotes.create(
          { vendorBillId: bill.id, reason: 'Todo impuesto', amount: 500, taxAmount: 500, expenseAccountId: account['expense'] },
          organizationId,
          ACTOR,
        ),
      ).rejects.toMatchObject({ messageKey: 'accounts_payable.debit_note_tax_exceeds_amount' });
    });

    it('refuses a counterpart account that does not take postings', async () => {
      const bill = await taxedBill();
      const group = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId,
          code: '5100',
          name: { es: 'Gastos' },
          type: AccountType.EXPENSE,
          category: AccountCategory.OPERATING_EXPENSE,
          nature: AccountNature.DEBIT,
          isPostable: false,
          isActive: true,
        }),
      );
      await expect(
        debitNotes.create(
          { vendorBillId: bill.id, reason: 'Cuenta de grupo', amount: 100, expenseAccountId: group.id },
          organizationId,
          ACTOR,
        ),
      ).rejects.toMatchObject({ messageKey: 'accounts_payable.account_not_postable' });
    });
  });

  /**
   * The supplier's statement of account (audit H-17): bills, payments and notes, each undoing on
   * the day its reversal was booked, with what is owed after every line.
   */
  describe('statement of account', () => {
    it('reads what was owed on any day, voids included on the day they were booked', async () => {
      const statements = new SupplierStatementService(dataSource);
      const bill = await payables.create(
        {
          vendorId,
          date: '2026-03-10',
          dueDate: '2026-04-09',
          lines: [{ product: 'Alquiler', quantity: 1, unitPrice: 20_000, expenseAccountId: account['expense'] }],
        } as CreateVendorBillDto,
        organizationId,
      );
      await payables.submitForApproval(bill.id, organizationId, ACTOR);
      const batch = await payables.payBills(
        { paymentDate: '2026-03-20', bankAccountId, lines: [{ vendorBillId: bill.id, amount: 8_000 }] },
        organizationId,
        ACTOR,
      );
      await debitNotes.create(
        { vendorBillId: bill.id, reason: 'Ajuste', amount: 1_000, expenseAccountId: account['expense'], date: '2026-04-02' },
        organizationId,
        ACTOR,
      );
      await vendorPayments.voidPayment(batch.id, { reason: 'Cheque devuelto', reversalDate: '2026-04-15' }, organizationId, ACTOR);

      const march = await statements.statement(organizationId, vendorId, { from: '2026-03-01', to: '2026-03-31' }, ACTOR);
      expect(march.currencyCode).toBe('DOP');
      expect(march.openingBalance).toBe(0);
      expect(march.movements.map((m) => [m.kind, m.amount, m.balance])).toEqual([
        ['bill', 20_000, 20_000],
        ['payment', -8_000, 12_000],
      ]);
      expect(march.closingBalance).toBe(12_000);

      const april = await statements.statement(organizationId, vendorId, { from: '2026-04-01', to: '2026-04-30' }, ACTOR);
      expect(april.openingBalance).toBe(12_000);
      expect(april.movements.map((m) => [m.date, m.kind, m.amount])).toEqual([
        ['2026-04-02', 'vendor_debit_note', -1_000],
        ['2026-04-15', 'payment_void', 8_000],
      ]);
      expect(april.totals).toEqual({ increases: 8_000, decreases: 1_000 });
      expect(april.closingBalance).toBe(19_000);
      // The bill's own balance agrees with the statement.
      expect((await payables.findOne(bill.id, organizationId)).balance).toBe(19_000);
    });
  });
});
