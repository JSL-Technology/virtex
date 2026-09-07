import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
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
import {
  AccountBalancesService,
  FX_REVALUATION_REASON,
} from '../chart-of-accounts/account-balances.service';
import { FinancialReportingService } from './financial-reporting.service';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';

/**
 * The statement of cash flows, against the presentation rules it has to satisfy.
 *
 * Tying to the change in cash was never the hard part — the statement is derived from the movement
 * of every non-cash account, and by double entry those sum to the movement in cash. What it could
 * not do was present that total the way IAS 7 and ASC 230 require: investing and financing were
 * netted per account, transactions that moved no cash appeared as equal and opposite flows, and
 * the period-end revaluation of a foreign-currency bank account was indistinguishable from a
 * deposit into it.
 *
 * Each test below is one of those rules, and each also re-asserts the tie — because a presentation
 * fix that quietly stops the statement from reconciling is worse than the presentation defect.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('the statement of cash flows', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let entries: JournalEntriesService;
  let reporting: FinancialReportingService;

  let organizationId: string;
  let ledgerId: string;
  let generalJournalId: string;
  const account: Record<string, string> = {};

  const ACTOR = '44444444-4444-4444-8444-444444444444';

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

    const balances = new AccountBalancesService(dataSource);
    reporting = new FinancialReportingService(dataSource, balances);

    entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null) } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      new AuditTrailService(dataSource.getRepository(AuditLog)),
      new ExchangeRateResolver(dataSource),
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Flujo ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = org.id;

    const ledger = await dataSource.getRepository(Ledger).save(
      dataSource.getRepository(Ledger).create({
        organizationId,
        name: 'Libro principal',
        currency: 'DOP',
        isDefault: true,
        isActive: true,
      }),
    );
    ledgerId = ledger.id;

    const journals = await dataSource.getRepository(Journal).save([
      { organizationId, code: 'GENERAL', name: 'Diario general', type: 'GENERAL' as const },
    ]);
    generalJournalId = journals[0].id;

    const make = async (
      key: string,
      code: string,
      name: string,
      type: AccountType,
      category: AccountCategory,
      nature: AccountNature,
      systemRole: AccountRole | null = null,
    ) => {
      const saved = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId,
          code,
          name: { es: name },
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

    await make('cash', '1101', 'Efectivo', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.CASH);
    await make('bank', '1102', 'Banco en dólares', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.BANK);
    await make('receivable', '1201', 'Cuentas por cobrar', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.ACCOUNTS_RECEIVABLE);
    await make('equipment', '1501', 'Equipos', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.DEBIT);
    await make('accumDep', '1591', 'Depreciación acumulada', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.CREDIT, AccountRole.ACCUMULATED_DEPRECIATION);
    await make('loan', '2501', 'Préstamo a largo plazo', AccountType.LIABILITY, AccountCategory.NON_CURRENT_LIABILITY, AccountNature.CREDIT);
    await make('capital', '3101', 'Capital social', AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, AccountNature.CREDIT);
    await make('revenue', '4101', 'Ingresos', AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, AccountNature.CREDIT, AccountRole.SALES_REVENUE);
    await make('gain', '4902', 'Ganancia cambiaria', AccountType.REVENUE, AccountCategory.NON_OPERATING_REVENUE, AccountNature.CREDIT, AccountRole.FOREX_GAIN_LOSS);
    await make('depreciation', '5201', 'Gasto de depreciación', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({
        organizationId,
        baseCurrency: 'DOP',
        defaultForexGainLossAccountId: account['gain'],
      }),
    );

    await dataSource.getRepository(AccountingPeriod).save([
      { organizationId, name: 'Enero 2026', startDate: '2026-01-01' as unknown as Date, endDate: '2026-01-31' as unknown as Date, status: PeriodStatus.OPEN },
    ]);
  });

  afterEach(async () => {
    await dataSource.getRepository(Organization).delete({ id: organizationId });
  });

  const post = (
    date: string,
    description: string,
    lines: { accountId: string; debit?: number; credit?: number }[],
    systemReason?: string,
  ): Promise<JournalEntry> =>
    entries.create(
      {
        date,
        description,
        journalId: generalJournalId,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit ?? 0,
          credit: line.credit ?? 0,
        })),
      } as CreateJournalEntryDto,
      organizationId,
      { actorUserId: ACTOR, systemReason },
    );

  const january = () =>
    reporting.getCashFlowStatement(organizationId, '2026-01-01', '2026-01-31');

  /** Cash to start with, so every test below has something for its flows to move. */
  const seedCapital = () =>
    post('2026-01-02', 'Aporte de capital', [
      { accountId: account['cash'], debit: 200_000 },
      { accountId: account['capital'], credit: 200_000 },
    ]);

  describe('gross presentation (IAS 7.21, ASC 230-10-45-7)', () => {
    it('shows a purchase and a disposal of the same class of asset as two flows, not their difference', async () => {
      await seedCapital();
      await post('2026-01-10', 'Compra de maquinaria', [
        { accountId: account['equipment'], debit: 80_000 },
        { accountId: account['cash'], credit: 80_000 },
      ]);
      await post('2026-01-20', 'Venta de maquinaria antigua', [
        { accountId: account['cash'], debit: 30_000 },
        { accountId: account['equipment'], credit: 30_000 },
      ]);

      const flow = await january();

      // The old statement summed the account's movement and reported a single −50,000. A reader
      // could not tell a year of 50,000 of investment from one of 80,000 spent and 30,000
      // recovered, and the two are not the same business.
      expect(flow.investing.outflows).toBe(80_000);
      expect(flow.investing.inflows).toBe(30_000);
      expect(flow.investing.total).toBe(-50_000);

      const line = flow.investing.movements.find(
        (movement) => movement.accountId === account['equipment'],
      );
      expect(line).toMatchObject({ inflow: 30_000, outflow: 80_000, amount: -50_000 });

      expect(flow.unexplainedDifference).toBe(0);
      expect(flow.openingCash + flow.netChangeInCash).toBe(flow.closingCash);
    });

    it('shows drawing and repaying debt separately instead of cancelling them', async () => {
      await seedCapital();
      await post('2026-01-05', 'Desembolso del préstamo', [
        { accountId: account['cash'], debit: 100_000 },
        { accountId: account['loan'], credit: 100_000 },
      ]);
      await post('2026-01-25', 'Amortización del préstamo', [
        { accountId: account['loan'], debit: 40_000 },
        { accountId: account['cash'], credit: 40_000 },
      ]);

      const flow = await january();

      // 200,000 of capital plus 100,000 drawn is 300,000 in; 40,000 repaid is out.
      expect(flow.financing.inflows).toBe(300_000);
      expect(flow.financing.outflows).toBe(40_000);
      expect(flow.financing.total).toBe(260_000);
      expect(flow.unexplainedDifference).toBe(0);
    });
  });

  describe('non-cash transactions (IAS 7.43)', () => {
    it('keeps an asset acquired on credit out of both investing and financing, and discloses it', async () => {
      await seedCapital();
      await post('2026-01-15', 'Equipo adquirido con financiamiento del proveedor', [
        { accountId: account['equipment'], debit: 120_000 },
        { accountId: account['loan'], credit: 120_000 },
      ]);

      const flow = await january();

      // No money moved. The old statement reported an investing outflow of 120,000 and a financing
      // inflow of 120,000 — two cash flows, netting to nothing, for a transaction that had none.
      expect(flow.investing.total).toBe(0);
      expect(flow.investing.outflows).toBe(0);
      expect(flow.financing.total).toBe(200_000); // the capital, and nothing else
      expect(flow.financing.inflows).toBe(200_000);

      const disclosed = flow.nonCashTransactions.map((line) => line.accountId).sort();
      expect(disclosed).toEqual([account['equipment'], account['loan']].sort());
      expect(
        flow.nonCashTransactions.find((line) => line.accountId === account['equipment']),
      ).toMatchObject({ debit: 120_000, credit: 0 });

      expect(flow.closingCash).toBe(200_000);
      expect(flow.unexplainedDifference).toBe(0);
      expect(flow.openingCash + flow.netChangeInCash).toBe(flow.closingCash);
    });

    it('still adds depreciation back rather than listing it as a non-cash investing transaction', async () => {
      await seedCapital();
      await post('2026-01-31', 'Depreciación del mes', [
        { accountId: account['depreciation'], debit: 9_000 },
        { accountId: account['accumDep'], credit: 9_000 },
      ]);

      const flow = await january();

      // The charge is in profit and the add-back cancels it: operating is unaffected, and nothing
      // appears in investing.
      expect(flow.operating.netIncome).toBe(-9_000);
      expect(
        flow.operating.nonCashAdjustments.find(
          (item) => item.accountId === account['accumDep'],
        )?.amount,
      ).toBe(9_000);
      expect(flow.operating.total).toBe(0);
      expect(flow.investing.total).toBe(0);
      // Depreciation is not an investing or financing transaction, so it is not what IAS 7.43
      // asks to be disclosed, however non-cash it is.
      expect(flow.nonCashTransactions).toEqual([]);
      expect(flow.unexplainedDifference).toBe(0);
    });
  });

  describe('the effect of exchange rates on cash (IAS 7.28, ASC 230-10-45-25)', () => {
    it('reports the revaluation of a foreign-currency bank account on its own line', async () => {
      await seedCapital();
      await post('2026-01-03', 'Traslado a la cuenta en dólares', [
        { accountId: account['bank'], debit: 50_000 },
        { accountId: account['cash'], credit: 50_000 },
      ]);
      // What the period-end batch posts: the dollar balance is worth more in pesos than it was.
      await post(
        '2026-01-31',
        'Revaluación de moneda extranjera',
        [
          { accountId: account['bank'], debit: 4_000 },
          { accountId: account['gain'], credit: 4_000 },
        ],
        FX_REVALUATION_REASON,
      );

      const flow = await january();

      // Its own reconciling line, outside the three sections. Classified by account category — all
      // there was before — this was a 4,000 deposit into a bank account, and it landed in
      // operating activities as if the company had earned it in cash.
      expect(flow.effectOfExchangeRateOnCash).toBe(4_000);

      // The unrealised gain is in profit, so it is reported there and removed by an adjustment
      // rather than silently dropped: the reader has to be able to reconcile this statement to the
      // income statement.
      expect(flow.operating.netIncome).toBe(4_000);
      expect(
        flow.operating.nonCashAdjustments.find((item) => item.accountId === account['gain'])
          ?.amount,
      ).toBe(-4_000);
      expect(flow.operating.total).toBe(0);

      expect(flow.closingCash).toBe(204_000);
      expect(flow.unexplainedDifference).toBe(0);
      expect(flow.openingCash + flow.netChangeInCash).toBe(flow.closingCash);
    });

    it('leaves the revaluation of a receivable out of working capital entirely', async () => {
      await seedCapital();
      await post('2026-01-05', 'Venta a crédito en divisa', [
        { accountId: account['receivable'], debit: 60_000 },
        { accountId: account['revenue'], credit: 60_000 },
      ]);
      // One revaluation entry covering both the bank account and the receivable, which is what the
      // batch actually posts: one document per ledger, not one per account.
      await post(
        '2026-01-31',
        'Revaluación de moneda extranjera',
        [
          { accountId: account['cash'], debit: 1_000 },
          { accountId: account['receivable'], debit: 3_000 },
          { accountId: account['gain'], credit: 4_000 },
        ],
        FX_REVALUATION_REASON,
      );

      const flow = await january();

      // Only the part that touched cash is the exchange-rate effect. The 3,000 restatement of the
      // receivable moved no cash and is not a working-capital movement — counting it as one would
      // have the statement explain 3,000 of cash that never existed.
      expect(flow.effectOfExchangeRateOnCash).toBe(1_000);
      expect(
        flow.operating.workingCapitalChanges.find(
          (item) => item.accountId === account['receivable'],
        )?.amount,
      ).toBe(-60_000);
      expect(flow.operating.total).toBe(0); // 60,000 revenue less 60,000 of receivable growth
      expect(flow.unexplainedDifference).toBe(0);
      expect(flow.openingCash + flow.netChangeInCash).toBe(flow.closingCash);
    });
  });
});
