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
    await dataSource.query('DELETE FROM "exchange_rate"');
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

      expect(await treasury.findAllTransfers(organizationId)).toHaveLength(1);
      expect(await treasury.findAllTransfers(other.id)).toHaveLength(0);

      await dataSource.getRepository(Organization).delete({ id: other.id });
    });
  });
});
