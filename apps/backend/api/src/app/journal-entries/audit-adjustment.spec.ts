import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Journal } from './entities/journal.entity';
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
import { FiscalYear, FiscalYearStatus } from '../accounting/entities/fiscal-year.entity';
import { JournalEntry, JournalEntryType } from './entities/journal-entry.entity';
import { JournalEntryAttachment } from './entities/journal-entry-attachment.entity';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntryNumberingService } from './journal-entry-numbering.service';
import { AdjustmentsService } from './adjustments.service';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { CreateAuditAdjustmentDto } from './dto/audit-adjustment.dto';
import { toIsoDate } from '../common/dates';

/**
 * The correction an external audit makes to a year that has already been closed.
 *
 * ## Why there was nothing to test before
 *
 * `createAuditAdjustment` could not run. `fiscal_years.end_date` is a `date` column, which the
 * driver returns as a string whatever the entity's type says, and the service called
 * `.toISOString()` on it — a guaranteed 500 on every invocation. And the design contradicted
 * itself: the method demanded a fiscal year that was *not* open, then posted through
 * `resolvePostingPeriod`, which refused every closed period. Even without the TypeError the
 * adjustment would have been rejected every time. Nothing covered it.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('audit adjustments to a closed year', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let adjustments: AdjustmentsService;
  let balances: AccountBalancesService;

  let organizationId: string;
  let ledgerId: string;
  let generalJournalId: string;
  let fiscalYearId: string;
  const account: Record<string, string> = {};

  const ACTOR = '55555555-5555-4555-8555-555555555555';

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
      new AuditTrailService(dataSource.getRepository(AuditLog)),
      new ExchangeRateResolver(dataSource),
    );
    adjustments = new AdjustmentsService(entries, dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Ajuste ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

    const journals = await dataSource.getRepository(Journal).save([
      { organizationId, code: 'GENERAL', name: 'Diario general', type: 'GENERAL' as const },
      { organizationId, code: 'CIERRE', name: 'Diario de cierre', type: 'GENERAL' as const },
    ]);
    generalJournalId = journals[0].id;

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

    await make('payable', '2101', AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, AccountNature.CREDIT, AccountRole.ACCOUNTS_PAYABLE);
    await make('prepaid', '1301', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT);
    await make('expense', '5101', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);
    await make('retained', '3201', AccountType.EQUITY, AccountCategory.RETAINED_EARNINGS, AccountNature.CREDIT, AccountRole.RETAINED_EARNINGS);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({
        organizationId,
        baseCurrency: 'DOP',
        defaultRetainedEarningsAccountId: account['retained'],
      }),
    );

    // The year is closed, and so is the period the adjustment lands in. That is the situation an
    // audit adjustment exists for, and the situation in which the previous code could not run.
    await dataSource.getRepository(AccountingPeriod).save([
      { organizationId, name: 'Diciembre 2025', startDate: '2025-12-01' as unknown as Date, endDate: '2025-12-31' as unknown as Date, status: PeriodStatus.CLOSED },
    ]);
    const year = await dataSource.getRepository(FiscalYear).save(
      dataSource.getRepository(FiscalYear).create({
        organizationId,
        startDate: '2025-01-01' as unknown as Date,
        endDate: '2025-12-31' as unknown as Date,
        status: FiscalYearStatus.CLOSED,
      }),
    );
    fiscalYearId = year.id;
  });

  afterEach(async () => {
    await dataSource.getRepository(Organization).delete({ id: organizationId });
  });

  const propose = (
    lines: { accountId: string; debit?: number; credit?: number }[],
  ): Promise<JournalEntry> =>
    adjustments.createAuditAdjustment(
      {
        fiscalYearId,
        description: 'Gasto devengado no registrado',
        journalId: generalJournalId,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit ?? 0,
          credit: line.credit ?? 0,
        })),
      } as CreateAuditAdjustmentDto,
      organizationId,
      ACTOR,
    );

  const signedBalance = async (key: string, asOf = '2025-12-31') =>
    (await balances.balancesAsOf({ organizationId, ledgerId, asOf })).get(account[key]) ?? 0;

  it('posts into the closed year, dated its last day', async () => {
    const entry = await propose([
      { accountId: account['expense'], debit: 25_000 },
      { accountId: account['payable'], credit: 25_000 },
    ]);

    expect(entry.entryType).toBe(JournalEntryType.AUDIT_ADJUSTMENT);
    // The fiscal year's own end date. The previous code called `.toISOString()` on the string a
    // `date` column returns and answered 500 to every request; `toIsoDate` takes either shape,
    // which is why the entry can be dated at all.
    expect(toIsoDate(entry.date)).toBe('2025-12-31');
    expect(await signedBalance('payable')).toBe(-25_000);
  });

  it('carries the adjustment through to retained earnings', async () => {
    await propose([
      { accountId: account['expense'], debit: 25_000 },
      { accountId: account['payable'], credit: 25_000 },
    ]);

    // The year is closed. An expense added to it without a matching transfer would leave retained
    // earnings disagreeing with the income statement of the year it came from — the very
    // disagreement an auditor is there to remove.
    expect(await signedBalance('expense')).toBe(0);
    expect(await signedBalance('retained')).toBe(25_000); // a debit: the profit is 25,000 lower
  });

  it('leaves retained earnings alone for a balance-sheet reclassification', async () => {
    await propose([
      { accountId: account['prepaid'], debit: 4_000 },
      { accountId: account['payable'], credit: 4_000 },
    ]);

    expect(await signedBalance('prepaid')).toBe(4_000);
    expect(await signedBalance('retained')).toBe(0);
  });

  it('refuses a year that is still open', async () => {
    await dataSource
      .getRepository(FiscalYear)
      .update({ id: fiscalYearId }, { status: FiscalYearStatus.OPEN });

    await expect(
      propose([
        { accountId: account['expense'], debit: 100 },
        { accountId: account['payable'], credit: 100 },
      ]),
    ).rejects.toMatchObject({
      messageKey: 'JOURNAL_ENTRIES.AJUSTES_AUDITORIA_SOLO_PUEDEN_APLICARSE_ANOS_FISCALES',
    });
  });

  it('refuses an archived year', async () => {
    await dataSource
      .getRepository(FiscalYear)
      .update({ id: fiscalYearId }, { status: FiscalYearStatus.LOCKED });

    // The exception the period control makes is for a closed year, never a locked one: archiving
    // is the statement that the year will not be touched again.
    await expect(
      propose([
        { accountId: account['expense'], debit: 100 },
        { accountId: account['payable'], credit: 100 },
      ]),
    ).rejects.toMatchObject({
      messageKey: 'JOURNAL_ENTRIES.ANO_FISCAL_ESTA_ARCHIVADO_NO_PUEDE_MODIFICAR',
    });
  });

  it('still refuses an ordinary entry into the same closed period', async () => {
    // The exception is for this entry type and no other. A closed period is closed.
    const entries = new JournalEntriesService(
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

    await expect(
      entries.create(
        {
          date: '2025-12-31',
          description: 'Un asiento cualquiera',
          journalId: generalJournalId,
          lines: [
            { accountId: account['expense'], debit: 100, credit: 0 },
            { accountId: account['payable'], debit: 0, credit: 100 },
          ],
        } as never,
        organizationId,
        { actorUserId: ACTOR },
      ),
    ).rejects.toMatchObject({
      messageKey: 'ACCOUNTING.FECHA_TRANSACCION_ESTA_DENTRO_PERIODO_CONTABLE_YA',
    });
  });
});
