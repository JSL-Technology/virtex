import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { testExchangeRateResolver } from '../currencies/exchange-rate-resolver.testing';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Journal } from './entities/journal.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { AccountCategory, AccountNature, AccountType } from '../chart-of-accounts/enums/account-enums';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryLine } from './entities/journal-entry-line.entity';
import { JournalEntryAttachment } from './entities/journal-entry-attachment.entity';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntryNumberingService } from './journal-entry-numbering.service';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { CreateJournalEntryDto, CreateJournalEntryLineDto } from './dto/create-journal-entry.dto';

/**
 * A line that states its own currency (audit 2026-11-07, FIN-JE-01; pattern SP-04).
 *
 * `{debit: 100, currencyCode: 'USD', foreignCurrencyDebit: 1, exchangeRate: 999}` was stored as
 * sent: one dollar at 999 booked as 100 pesos, a dollar balance the revaluation then restated. The
 * entry-level rate was already held to the published quote; the per-line one was not held to
 * anything, not even to its own arithmetic.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('journal entry lines in their own currency', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let entries: JournalEntriesService;
  let organizationId: string;
  let journalId: string;
  let bankUsd: string;
  let bankDop: string;
  // A currency code of its own, so the quote this suite writes is not read by another suite.
  const FOREIGN = `Q${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  const DATE = '2026-06-10';
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
    entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null), announcePending: jest.fn() } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      new AuditTrailService(dataSource.getRepository(AuditLog)),
      testExchangeRateResolver(dataSource),
    );
    await dataSource.getRepository(ExchangeRate).save({
      fromCurrency: FOREIGN,
      toCurrency: 'DOP',
      rate: 58.5,
      date: new Date(`${DATE}T00:00:00.000Z`),
    });
  });

  afterAll(async () => {
    await dataSource?.getRepository(ExchangeRate).delete({ fromCurrency: FOREIGN });
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Divisa ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = org.id;
    await dataSource.getRepository(Ledger).save(
      dataSource.getRepository(Ledger).create({ organizationId, name: 'Principal', currency: 'DOP', isDefault: true, isActive: true }),
    );
    const [journal] = await dataSource.getRepository(Journal).save([
      { organizationId, code: 'GENERAL', name: 'Diario general', type: 'GENERAL' as const },
    ]);
    journalId = journal.id;
    const make = async (code: string) =>
      (
        await dataSource.getRepository(Account).save(
          dataSource.getRepository(Account).create({
            organizationId,
            code,
            name: { es: code },
            type: AccountType.ASSET,
            category: AccountCategory.CURRENT_ASSET,
            nature: AccountNature.DEBIT,
            isPostable: true,
            isActive: true,
          }),
        )
      ).id;
    bankUsd = await make('1102');
    bankDop = await make('1101');
    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({ organizationId, baseCurrency: 'DOP' }),
    );
  });

  afterEach(async () => {
    await dataSource.getRepository(Organization).delete({ id: organizationId });
  });

  /** A transfer from the peso account into the dollar one: the dollar line states its currency. */
  const transfer = (usdLine: Partial<CreateJournalEntryLineDto>, pesos: number, system = false) =>
    entries.create(
      {
        date: DATE,
        description: 'Compra de dólares',
        journalId,
        lines: [
          { accountId: bankUsd, debit: pesos, credit: 0, ...usdLine },
          { accountId: bankDop, debit: 0, credit: pesos },
        ],
      } as CreateJournalEntryDto,
      organizationId,
      { actorUserId: ACTOR, ...(system ? { systemReason: 'Prueba' } : {}) } as never,
    );

  const usdLineOf = async (entry: JournalEntry) =>
    dataSource.getRepository(JournalEntryLine).findOneByOrFail({ journalEntry: { id: entry.id }, accountId: bankUsd });

  it('refuses one dollar at 999 booked as 100 pesos: the line does not add up', async () => {
    await expect(
      transfer({ currencyCode: FOREIGN, foreignCurrencyDebit: 1, exchangeRate: 999 }, 100),
    ).rejects.toMatchObject({ messageKey: 'journal_entries.line_currency_amount_inconsistent' });
  });

  it('refuses a rate that adds up but is far from the published quote', async () => {
    // 1 × 999 = 999: arithmetic right, rate invented. 58.50 was published for the day.
    await expect(
      transfer({ currencyCode: FOREIGN, foreignCurrencyDebit: 1, exchangeRate: 999 }, 999),
    ).rejects.toMatchObject({ messageKey: 'currencies.stated_rate_requested_deviates_too_far' });
    // …and the same with no rate stated: the implied rate, 999, is what is checked.
    await expect(
      transfer({ currencyCode: FOREIGN, foreignCurrencyDebit: 1 }, 999),
    ).rejects.toMatchObject({ messageKey: 'currencies.stated_rate_requested_deviates_too_far' });
  });

  it('accepts the bank rate within the tolerance, and records the rate implied when none is stated', async () => {
    const stated = await transfer({ currencyCode: FOREIGN, foreignCurrencyDebit: 100, exchangeRate: 58.8 }, 5_880);
    expect(await usdLineOf(stated)).toMatchObject({ debit: 5_880, foreignCurrencyDebit: 100, exchangeRate: 58.8 });

    const implied = await transfer({ currencyCode: FOREIGN, foreignCurrencyDebit: 100 }, 5_855);
    expect(await usdLineOf(implied)).toMatchObject({ foreignCurrencyDebit: 100, exchangeRate: 58.55 });
  });

  it('refuses the document amount on the other side of the ledger amount', async () => {
    await expect(
      transfer({ currencyCode: FOREIGN, foreignCurrencyCredit: 100, exchangeRate: 58.5 }, 5_850),
    ).rejects.toMatchObject({ messageKey: 'journal_entries.line_currency_side_mismatch' });
  });

  it('lets only the system post a ledger amount with no document amount (a revaluation)', async () => {
    await expect(transfer({ currencyCode: FOREIGN, exchangeRate: 58.5 }, 150)).rejects.toMatchObject({
      messageKey: 'journal_entries.line_currency_amount_required',
    });
    const revaluation = await transfer({ currencyCode: FOREIGN, foreignCurrencyDebit: 0, exchangeRate: 58.5 }, 150, true);
    expect(await usdLineOf(revaluation)).toMatchObject({ debit: 150, foreignCurrencyDebit: 0 });
  });

  it('holds a line in the books currency to the same amount', async () => {
    await expect(
      transfer({ currencyCode: 'DOP', foreignCurrencyDebit: 90 }, 100),
    ).rejects.toMatchObject({ messageKey: 'journal_entries.line_currency_base_amount_mismatch' });
  });
});
