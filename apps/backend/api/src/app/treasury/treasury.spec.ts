import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
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
import { FiscalCalendarService } from '../shared/fiscal-calendar.service';
import { FiscalYear } from '../accounting/entities/fiscal-year.entity';
import { TreasuryService } from './treasury.service';
import { BankAccount, BankAccountType } from './entities/bank-account.entity';
import { CreateBankTransferDto } from './dto/create-bank-transfer.dto';

/**
 * Treasury: bank accounts, cash position, transfers.
 *
 * None of this could be tested before, because none of it existed: there was no bank account
 * entity, no cash position, and the one transfer endpoint moved a number between two rows of the
 * chart of accounts. The assertions that matter here are that a cross-currency transfer balances
 * (its two sides are different amounts, and the difference is a realised exchange effect that has
 * to be booked, not absorbed), that a bank charge is an expense rather than netted into the forex
 * account, and that the account number never leaves the server in full.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('treasury', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let treasury: TreasuryService;
  let balances: AccountBalancesService;

  let organizationId: string;
  let ledgerId: string;
  const account: Record<string, string> = {};

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

    treasury = new TreasuryService(
      dataSource.getRepository(BankAccount),
      entries,
      balances,
      new ExchangeRateResolver(dataSource),
      new FiscalCalendarService(
        dataSource.getRepository(Organization),
        dataSource.getRepository(FiscalYear),
      ),
      dataSource,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `TR ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

    await dataSource
      .getRepository(Journal)
      .save([
        { organizationId, code: 'BANCOS', name: 'Bancos', type: 'BANK' as const },
      ]);

    const make = async (
      key: string,
      code: string,
      type: AccountType,
      category: AccountCategory,
      nature: AccountNature,
      systemRole: AccountRole | null = null,
      isPostable = true,
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
          isPostable,
          isActive: true,
        }),
      );
      account[key] = saved.id;
    };

    await make('bankDop', '1102', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.BANK);
    await make('bankUsd', '1103', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT);
    await make('cash', '1101', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT);
    await make('fees', '5210', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);
    await make('forex', '5901', AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, AccountNature.DEBIT, AccountRole.FOREX_GAIN_LOSS);
    await make('grouping', '11', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, null, false);
    // Where an opening balance's counterpart goes: opening-balance equity, in a real chart.
    await make('equity', '3150', AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, AccountNature.CREDIT);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({
        organizationId,
        baseCurrency: 'DOP',
        defaultBankFeesAccountId: account['fees'],
        defaultForexGainLossAccountId: account['forex'],
      }),
    );

    await dataSource.getRepository(AccountingPeriod).save([
      { organizationId, name: 'Marzo 2026', startDate: '2026-03-01' as unknown as Date, endDate: '2026-03-31' as unknown as Date, status: PeriodStatus.OPEN },
    ]);
  });

  afterEach(async () => {
    await dataSource
      .getRepository(Organization)
      .delete({ id: organizationId });
    // Scoped to the pair this suite publishes. `DELETE FROM "exchange_rate"` with no predicate
    // deletes every other suite's rates as well, and Jest runs suites in parallel workers against
    // one database — so an unscoped delete here made the consolidation and exchange-rate suites
    // fail intermittently with "no rate found" for pairs they had just inserted.
    await dataSource.query(
      'DELETE FROM "exchange_rate" WHERE "fromCurrency" = $1 AND "toCurrency" = $2',
      ['USD', 'DOP'],
    );
  });

  const openAccount = (overrides: Partial<Parameters<TreasuryService['createBankAccount']>[0]> = {}) =>
    treasury.createBankAccount(
      {
        name: 'Popular corriente',
        bankName: 'Banco Popular',
        accountNumber: '7901234567',
        accountType: BankAccountType.CHECKING,
        currencyCode: 'DOP',
        glAccountId: account['bankDop'],
        ...overrides,
      } as never,
      organizationId,
      ACTOR,
    );

  const signedBalance = async (key: string, asOf = '2026-03-31') =>
    (await balances.balancesAsOf({ organizationId, ledgerId, asOf })).get(account[key]) ?? 0;

  // ── bank accounts ──────────────────────────────────────────────────────────

  describe('bank accounts', () => {
    it('refuses a control account that belongs to another tenant', async () => {
      const other = await dataSource.getRepository(Organization).save(
        dataSource.getRepository(Organization).create({
          legalName: `TR other ${Date.now()}`,
          timezone: 'America/Santo_Domingo',
        }),
      );
      const foreign = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId: other.id,
          code: '1102',
          name: { es: 'Banco ajeno' },
          type: AccountType.ASSET,
          category: AccountCategory.CURRENT_ASSET,
          nature: AccountNature.DEBIT,
          isPostable: true,
          isActive: true,
        }),
      );

      await expect(openAccount({ glAccountId: foreign.id } as never)).rejects.toThrow();

      await dataSource.getRepository(Organization).delete({ id: other.id });
    });

    it('refuses a grouping account, which cannot take movements', async () => {
      await expect(
        openAccount({ glAccountId: account['grouping'] } as never),
      ).rejects.toThrow();
    });

    it('normalises the currency code', async () => {
      const saved = await openAccount({ currencyCode: 'usd' } as never);
      expect(saved.currencyCode).toBe('USD');
    });

    it('never changes the currency or the control account of an account with history', async () => {
      const saved = await openAccount();
      const updated = await treasury.updateBankAccount(
        saved.id,
        {
          name: 'Popular corriente (renombrada)',
          // Both of these are deliberately absent from UpdateBankAccountDto; a body carrying
          // them anyway must not move movements already measured against them.
          currencyCode: 'USD',
          glAccountId: account['cash'],
        } as never,
        organizationId,
      );

      expect(updated.name).toBe('Popular corriente (renombrada)');
      expect(updated.currencyCode).toBe('DOP');
      expect(updated.glAccountId).toBe(account['bankDop']);
    });

    it('does not find another tenant\'s bank account', async () => {
      const saved = await openAccount();
      const other = await dataSource.getRepository(Organization).save(
        dataSource.getRepository(Organization).create({
          legalName: `TR other ${Date.now()}`,
          timezone: 'America/Santo_Domingo',
        }),
      );

      await expect(treasury.findBankAccount(saved.id, other.id)).rejects.toThrow();

      await dataSource.getRepository(Organization).delete({ id: other.id });
    });
  });

  // ── cash position ──────────────────────────────────────────────────────────

  describe('cash position', () => {
    it('masks the account number and reports the control account balance', async () => {
      await openAccount();

      await dataSource.query(
        `INSERT INTO "bank_accounts" ("organization_id", "name", "account_number", "account_type",
           "currency_code", "gl_account_id")
         VALUES ($1, 'Caja chica', NULL, 'CASH', 'DOP', $2)`,
        [organizationId, account['cash']],
      );

      const journal = await dataSource
        .getRepository(Journal)
        .findOneByOrFail({ organizationId, code: 'BANCOS' });
      await dataSource.transaction((manager) =>
        (treasury as never as { journalEntriesService: JournalEntriesService })
          .journalEntriesService.createWithManager(
            manager,
            {
              date: '2026-03-05',
              description: 'Depósito inicial',
              journalId: journal.id,
              lines: [
                {
                  accountId: account['bankDop'],
                  debit: 250_000,
                  credit: 0,
                  valuations: [{ ledgerId, debit: 250_000, credit: 0 }],
                },
                {
                  accountId: account['cash'],
                  debit: 0,
                  credit: 250_000,
                  valuations: [{ ledgerId, debit: 0, credit: 250_000 }],
                },
              ],
            } as never,
            organizationId,
            { actorUserId: ACTOR, systemReason: 'test' },
          ),
      );

      const position = await treasury.cashPosition(organizationId, '2026-03-31');

      const popular = position.accounts.find((row) => row.name === 'Popular corriente');
      expect(popular?.accountNumberMasked).toBe('••••4567');
      expect(popular?.balanceInBaseCurrency).toBe(250_000);

      const petty = position.accounts.find((row) => row.name === 'Caja chica');
      expect(petty?.accountNumberMasked).toBeNull();
      expect(petty?.balanceInBaseCurrency).toBe(-250_000);

      // The two net to zero. A cash position that double-counted would show 250,000.
      expect(position.total).toBe(0);
      expect(position.baseCurrency).toBe('DOP');
    });

    it('counts a shared control account once, not once per bank account', async () => {
      await openAccount({ accountNumber: '7901234567' } as never);
      await openAccount({ name: 'Popular ahorros', accountNumber: '7909999999' } as never);

      const journal = await dataSource
        .getRepository(Journal)
        .findOneByOrFail({ organizationId, code: 'BANCOS' });
      await dataSource.transaction((manager) =>
        (treasury as never as { journalEntriesService: JournalEntriesService })
          .journalEntriesService.createWithManager(
            manager,
            {
              date: '2026-03-05',
              description: 'Depósito',
              journalId: journal.id,
              lines: [
                {
                  accountId: account['bankDop'],
                  debit: 100_000,
                  credit: 0,
                  valuations: [{ ledgerId, debit: 100_000, credit: 0 }],
                },
                {
                  accountId: account['cash'],
                  debit: 0,
                  credit: 100_000,
                  valuations: [{ ledgerId, debit: 0, credit: 100_000 }],
                },
              ],
            } as never,
            organizationId,
            { actorUserId: ACTOR, systemReason: 'test' },
          ),
      );

      const position = await treasury.cashPosition(organizationId, '2026-03-31');
      expect(position.accounts).toHaveLength(2);
      expect(position.total).toBe(100_000);
    });

    /**
     * How many dollars are in the dollar account.
     *
     * The row stated the account's `currencyCode` beside a figure measured in the BOOKS' currency
     * and offered nothing else, so a screen rendering "currency + balance" — the obvious thing to
     * render — showed `USD 58,162.50` for an account holding 990 dollars. It is also the only
     * figure a treasurer can check against a bank statement.
     */
    it('states a foreign account’s balance in its own currency as well as the books’', async () => {
      await dataSource.getRepository(ExchangeRate).save({
        fromCurrency: 'USD',
        toCurrency: 'DOP',
        rate: 58.75,
        date: new Date('2026-03-01T00:00:00.000Z'),
      });

      const from = await openAccount();
      const to = await treasury.createBankAccount(
        {
          name: 'Reservas USD',
          accountType: BankAccountType.SAVINGS,
          currencyCode: 'USD',
          glAccountId: account['bankUsd'],
        } as never,
        organizationId,
        ACTOR,
      );
      await treasury.createBankTransfer(
        {
          date: '2026-03-12',
          amount: 58_750,
          amountReceived: 990,
          fromBankAccountId: from.id,
          toBankAccountId: to.id,
          description: 'Compra de divisas',
        } as CreateBankTransferDto,
        organizationId,
        ACTOR,
      );

      const position = await treasury.cashPosition(organizationId, '2026-03-31');

      const dollars = position.accounts.find((row) => row.bankAccountId === to.id);
      expect(dollars?.currencyCode).toBe('USD');
      expect(dollars?.balanceInAccountCurrency).toBe(990);
      expect(dollars?.balanceInBaseCurrency).toBe(58_162.5);
      expect(dollars?.currencyBalanceUnavailable).toBeNull();

      // An account kept in the books' own currency needs no conversion, and saying the two figures
      // are the same number is more useful than leaving the column empty.
      const pesos = position.accounts.find((row) => row.bankAccountId === from.id);
      expect(pesos?.balanceInAccountCurrency).toBe(pesos?.balanceInBaseCurrency);
      expect(pesos?.currencyBalanceUnavailable).toBeNull();
    });

    /**
     * A figure that cannot be stated honestly is stated as absent, with the reason.
     *
     * Entries posted before per-line currency existed carry no document amount, and there is
     * nothing in the ledger to derive one from. Dividing the ledger figure by today's rate would
     * produce a different "balance" every day.
     */
    it('says why a foreign balance is unavailable rather than inventing one', async () => {
      const dollarAccount = await treasury.createBankAccount(
        {
          name: 'Reservas USD sin historial',
          accountType: BankAccountType.SAVINGS,
          currencyCode: 'USD',
          glAccountId: account['bankUsd'],
        } as never,
        organizationId,
        ACTOR,
      );

      const journal = await dataSource
        .getRepository(Journal)
        .findOneByOrFail({ organizationId, code: 'BANCOS' });
      await dataSource.transaction((manager) =>
        (treasury as never as { journalEntriesService: JournalEntriesService })
          .journalEntriesService.createWithManager(
            manager,
            {
              date: '2026-03-05',
              description: 'Asiento sin moneda de documento',
              journalId: journal.id,
              lines: [
                {
                  accountId: account['bankUsd'],
                  debit: 58_750,
                  credit: 0,
                  valuations: [{ ledgerId, debit: 58_750, credit: 0 }],
                },
                {
                  accountId: account['cash'],
                  debit: 0,
                  credit: 58_750,
                  valuations: [{ ledgerId, debit: 0, credit: 58_750 }],
                },
              ],
            } as never,
            organizationId,
            { actorUserId: ACTOR, systemReason: 'test' },
          ),
      );

      const position = await treasury.cashPosition(organizationId, '2026-03-31');
      const row = position.accounts.find((entry) => entry.bankAccountId === dollarAccount.id);

      expect(row?.balanceInBaseCurrency).toBe(58_750);
      expect(row?.balanceInAccountCurrency).toBeNull();
      expect(row?.currencyBalanceUnavailable).toBe('NOT_RECORDED');
    });
  });

  // ── opening balances ───────────────────────────────────────────────────────

  /**
   * `opening_balance` was written on create and read by nothing.
   *
   * Every figure the product shows is derived from the general ledger, so a balance that never
   * reached the ledger was invisible in all of them — and invisible *consistently*, because the
   * cash position and the balance sheet both read the same ledger and therefore agreed with each
   * other. A treasurer who typed 250,000 saw a cash position of zero and had nothing to tell them
   * why.
   */
  describe('opening balances', () => {
    it('posts the opening balance into the ledger and records the entry', async () => {
      const opened = await treasury.createBankAccount(
        {
          name: `Apertura ${Date.now()}`,
          accountType: BankAccountType.CHECKING,
          currencyCode: 'DOP',
          glAccountId: account['bankDop'],
          openingBalance: 250_000,
          openingDate: '2026-03-01',
          openingBalanceAccountId: account['equity'],
        } as never,
        organizationId,
        ACTOR,
      );

      expect(opened.openingBalance).toBe(250_000);
      expect(opened.openingJournalEntryId).toBeTruthy();

      // The ledger, not the column, is what every report reads — so this is the assertion that
      // matters.
      expect(await signedBalance('bankDop')).toBe(250_000);
      expect(await signedBalance('equity')).toBe(-250_000);

      const position = await treasury.cashPosition(organizationId, '2026-03-31');
      expect(
        position.accounts.find((row) => row.bankAccountId === opened.id)?.balanceInBaseCurrency,
      ).toBe(250_000);
    });

    it('refuses an opening balance with no counterpart account', async () => {
      await expect(
        treasury.createBankAccount(
          {
            name: `Sin contrapartida ${Date.now()}`,
            accountType: BankAccountType.CHECKING,
            currencyCode: 'DOP',
            glAccountId: account['bankDop'],
            openingBalance: 250_000,
            openingDate: '2026-03-01',
          } as never,
          organizationId,
          ACTOR,
        ),
      ).rejects.toMatchObject({
        messageKey: 'TREASURY.SALDO_APERTURA_REQUIERE_CONTRAPARTIDA',
      });

      // And nothing was created: the whole thing is one transaction.
      expect(
        await dataSource
          .getRepository(BankAccount)
          .countBy({ organizationId, name: 'Sin contrapartida' }),
      ).toBe(0);
    });

    it('refuses an opening balance with no date', async () => {
      await expect(
        treasury.createBankAccount(
          {
            name: `Sin fecha ${Date.now()}`,
            accountType: BankAccountType.CHECKING,
            currencyCode: 'DOP',
            glAccountId: account['bankDop'],
            openingBalance: 250_000,
            openingBalanceAccountId: account['equity'],
          } as never,
          organizationId,
          ACTOR,
        ),
      ).rejects.toMatchObject({ messageKey: 'TREASURY.SALDO_APERTURA_REQUIERE_FECHA' });
    });

    it('refuses a counterpart that is the bank’s own control account', async () => {
      await expect(
        treasury.createBankAccount(
          {
            name: `Contra sí misma ${Date.now()}`,
            accountType: BankAccountType.CHECKING,
            currencyCode: 'DOP',
            glAccountId: account['bankDop'],
            openingBalance: 250_000,
            openingDate: '2026-03-01',
            openingBalanceAccountId: account['bankDop'],
          } as never,
          organizationId,
          ACTOR,
        ),
      ).rejects.toMatchObject({
        messageKey: 'TREASURY.CONTRAPARTIDA_NO_PUEDE_SER_MISMA_CUENTA',
      });
    });

    it('opens an account with no balance without posting anything', async () => {
      const opened = await openAccount({ name: `Sin saldo ${Date.now()}` } as never);
      expect(opened.openingBalance).toBe(0);
      expect(opened.openingJournalEntryId).toBeNull();
    });

    /** A foreign-currency opening balance keeps the amount the account actually held. */
    it('records a foreign opening balance in the account’s own currency', async () => {
      await dataSource.getRepository(ExchangeRate).save({
        fromCurrency: 'USD',
        toCurrency: 'DOP',
        rate: 58.75,
        date: new Date('2026-03-01T00:00:00.000Z'),
      });

      const opened = await treasury.createBankAccount(
        {
          name: `Apertura USD ${Date.now()}`,
          accountType: BankAccountType.SAVINGS,
          currencyCode: 'USD',
          glAccountId: account['bankUsd'],
          openingBalance: 1_000,
          openingDate: '2026-03-01',
          openingBalanceAccountId: account['equity'],
        } as never,
        organizationId,
        ACTOR,
      );

      // 1,000 dollars, worth 58,750 pesos on the day.
      expect(await signedBalance('bankUsd')).toBe(58_750);

      const inDollars = await balances.foreignCurrencyBalancesAsOf({
        organizationId,
        ledgerId,
        asOf: '2026-03-31',
        currencyCode: 'USD',
      });
      expect(inDollars.get(account['bankUsd'])).toBe(1_000);

      const position = await treasury.cashPosition(organizationId, '2026-03-31');
      expect(
        position.accounts.find((row) => row.bankAccountId === opened.id)
          ?.balanceInAccountCurrency,
      ).toBe(1_000);
    });
  });

  // ── transfers ──────────────────────────────────────────────────────────────

  describe('transfers', () => {
    const openPair = async () => {
      const from = await openAccount();
      const to = await treasury.createBankAccount(
        {
          name: 'Reservas USD',
          bankName: 'Banco de Reservas',
          accountNumber: '9600000001',
          accountType: BankAccountType.SAVINGS,
          currencyCode: 'USD',
          glAccountId: account['bankUsd'],
        } as never,
        organizationId,
        ACTOR,
      );
      return { from, to };
    };

    it('refuses a transfer to the same account', async () => {
      const from = await openAccount();
      await expect(
        treasury.createBankTransfer(
          {
            date: '2026-03-10',
            amount: 1_000,
            fromBankAccountId: from.id,
            toBankAccountId: from.id,
            description: 'Círculo',
          } as CreateBankTransferDto,
          organizationId,
          ACTOR,
        ),
      ).rejects.toThrow();
    });

    it('refuses an inactive account', async () => {
      const { from, to } = await openPair();
      await treasury.updateBankAccount(to.id, { isActive: false } as never, organizationId);

      await expect(
        treasury.createBankTransfer(
          {
            date: '2026-03-10',
            amount: 1_000,
            fromBankAccountId: from.id,
            toBankAccountId: to.id,
            amountReceived: 17,
            description: 'A cuenta cerrada',
          } as CreateBankTransferDto,
          organizationId,
          ACTOR,
        ),
      ).rejects.toThrow();
    });

    it('refuses a cross-currency transfer that does not say what arrived', async () => {
      const { from, to } = await openPair();
      await expect(
        treasury.createBankTransfer(
          {
            date: '2026-03-10',
            amount: 58_750,
            fromBankAccountId: from.id,
            toBankAccountId: to.id,
            description: 'Sin monto recibido',
          } as CreateBankTransferDto,
          organizationId,
          ACTOR,
        ),
      ).rejects.toThrow();
    });

    it('moves funds between two same-currency accounts and books the fee as an expense', async () => {
      const from = await openAccount();
      const to = await treasury.createBankAccount(
        {
          name: 'Caja chica',
          accountType: BankAccountType.CASH,
          currencyCode: 'DOP',
          glAccountId: account['cash'],
        } as never,
        organizationId,
        ACTOR,
      );

      const transfer = await treasury.createBankTransfer(
        {
          date: '2026-03-10',
          amount: 10_000,
          fee: 150,
          fromBankAccountId: from.id,
          toBankAccountId: to.id,
          description: 'Reposición de caja',
        } as CreateBankTransferDto,
        organizationId,
        ACTOR,
      );

      // What left is 10,000; the bank kept 150, so 9,850 arrived.
      expect(transfer.amountReceived).toBe(9_850);
      expect(transfer.journalEntryId).toBeTruthy();

      expect(await signedBalance('bankDop')).toBe(-10_000);
      expect(await signedBalance('cash')).toBe(9_850);
      // The charge is a cost of banking, not an exchange difference.
      expect(await signedBalance('fees')).toBe(150);
      expect(await signedBalance('forex')).toBe(0);
    });

    it('balances a cross-currency transfer on its exchange difference', async () => {
      await dataSource.getRepository(ExchangeRate).save({
        fromCurrency: 'USD',
        toCurrency: 'DOP',
        rate: 58.75,
        date: new Date('2026-03-01T00:00:00.000Z'),
      });

      const { from, to } = await openPair();

      // 58,750 DOP leave; the bank applies its own rate and 990 USD arrive, worth 58,162.50 DOP
      // at the day's rate. The 587.50 difference is realised, not absorbed.
      const transfer = await treasury.createBankTransfer(
        {
          date: '2026-03-12',
          amount: 58_750,
          amountReceived: 990,
          fromBankAccountId: from.id,
          toBankAccountId: to.id,
          description: 'Compra de divisas',
        } as CreateBankTransferDto,
        organizationId,
        ACTOR,
      );

      expect(transfer.amountReceived).toBe(990);

      expect(await signedBalance('bankDop')).toBe(-58_750);
      expect(await signedBalance('bankUsd')).toBe(58_162.5);
      expect(await signedBalance('forex')).toBe(587.5);

      // And the entry it produced balances to the cent.
      const [totals] = await dataSource.query<
        { debit: string; credit: string }[]
      >(
        `SELECT COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
           FROM "journal_entry_lines" WHERE "journal_entry_id" = $1`,
        [transfer.journalEntryId],
      );
      expect(Math.round(Number(totals.debit) * 100)).toBe(
        Math.round(Number(totals.credit) * 100),
      );
    });

    /**
     * A cross-currency transfer keeps BOTH original amounts.
     *
     * The entry-level `currencyCode`/`exchangeRate` pair converts every line at one rate, which
     * cannot describe this entry: its two bank lines are in different currencies by construction.
     * So the transfer stored no document-currency amount at all, and
     * `foreignCurrencyBalancesAsOf` — which the period-end revaluation restates at the closing
     * rate — never saw a single transfer. Whatever a tenant moved into its dollar account was
     * simply outside the exposure being revalued.
     */
    it('records what each side of a cross-currency transfer was in its own currency', async () => {
      await dataSource.getRepository(ExchangeRate).save({
        fromCurrency: 'USD',
        toCurrency: 'DOP',
        rate: 58.75,
        date: new Date('2026-03-01T00:00:00.000Z'),
      });

      const { from, to } = await openPair();
      const transfer = await treasury.createBankTransfer(
        {
          date: '2026-03-12',
          amount: 58_750,
          amountReceived: 990,
          fromBankAccountId: from.id,
          toBankAccountId: to.id,
          description: 'Compra de divisas',
        } as CreateBankTransferDto,
        organizationId,
        ACTOR,
      );

      const lines = await dataSource.query<
        {
          account_id: string;
          currency_code: string | null;
          foreign_currency_debit: string | null;
          foreign_currency_credit: string | null;
        }[]
      >(
        `SELECT account_id, currency_code, foreign_currency_debit, foreign_currency_credit
           FROM "journal_entry_lines" WHERE "journal_entry_id" = $1`,
        [transfer.journalEntryId],
      );

      // The dollar side says 990 dollars arrived, not 58,162.50 pesos.
      const usdLine = lines.find((line) => line.account_id === account['bankUsd']);
      expect(usdLine?.currency_code).toBe('USD');
      expect(Number(usdLine?.foreign_currency_debit)).toBe(990);

      // The peso side is the ledger's own currency, so it carries no separate document amount.
      const dopLine = lines.find((line) => line.account_id === account['bankDop']);
      expect(dopLine?.currency_code).toBeNull();

      // And the figure the period-end revaluation reads now sees the transfer.
      const inDollars = await balances.foreignCurrencyBalancesAsOf({
        organizationId,
        ledgerId,
        asOf: '2026-03-31',
        currencyCode: 'USD',
      });
      expect(inDollars.get(account['bankUsd'])).toBe(990);
    });

    it('lists only the calling tenant\'s transfers', async () => {
      const from = await openAccount();
      const to = await treasury.createBankAccount(
        {
          name: 'Caja chica',
          accountType: BankAccountType.CASH,
          currencyCode: 'DOP',
          glAccountId: account['cash'],
        } as never,
        organizationId,
        ACTOR,
      );
      await treasury.createBankTransfer(
        {
          date: '2026-03-10',
          amount: 5_000,
          fromBankAccountId: from.id,
          toBankAccountId: to.id,
          description: 'Reposición',
        } as CreateBankTransferDto,
        organizationId,
        ACTOR,
      );

      const other = await dataSource.getRepository(Organization).save(
        dataSource.getRepository(Organization).create({
          legalName: `TR other ${Date.now()}`,
          timezone: 'America/Santo_Domingo',
        }),
      );

      const mine = await treasury.findAllTransfers(organizationId);
      expect(mine.rows).toHaveLength(1);
      expect(mine.total).toBe(1);

      const theirs = await treasury.findAllTransfers(other.id);
      expect(theirs.rows).toHaveLength(0);
      expect(theirs.total).toBe(0);

      await dataSource.getRepository(Organization).delete({ id: other.id });
    });

    /**
     * The route returned every transfer the tenant had ever made, in one array.
     *
     * A treasury that moves funds daily crosses ten thousand rows in a few years, and the response
     * — and the memory to assemble it — grew without limit.
     */
    it('returns a page, and says how many rows there are behind it', async () => {
      const from = await openAccount();
      const to = await treasury.createBankAccount(
        {
          name: `Destino ${Date.now()}`,
          accountType: BankAccountType.CASH,
          currencyCode: 'DOP',
          glAccountId: account['cash'],
        } as never,
        organizationId,
        ACTOR,
      );

      for (let index = 0; index < 3; index += 1) {
        await treasury.createBankTransfer(
          {
            date: `2026-03-2${index + 1}`,
            amount: 100 + index,
            fromBankAccountId: from.id,
            toBankAccountId: to.id,
            description: `Traspaso ${index}`,
          } as CreateBankTransferDto,
          organizationId,
          ACTOR,
        );
      }

      const firstPage = await treasury.findAllTransfers(organizationId, { pageSize: 2 });
      expect(firstPage.rows).toHaveLength(2);
      expect(firstPage.total).toBeGreaterThanOrEqual(3);
      expect(firstPage.hasMore).toBe(true);
      // Newest first, so the page opens on the latest transfer.
      expect(firstPage.rows[0].date).toBe('2026-03-23');

      const secondPage = await treasury.findAllTransfers(organizationId, {
        page: 2,
        pageSize: 2,
      });
      expect(secondPage.page).toBe(2);
      expect(secondPage.rows.map((row) => row.id)).not.toEqual(
        firstPage.rows.map((row) => row.id),
      );
    });
  });
});
