import { DataSource } from 'typeorm';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  openTestDataSource,
} from '../common/database/testing/integration-db';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { DataTransferContext } from '../contracts/data-transfer/data-transfer.contract';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { JournalEntryType } from './entities/journal-entry.entity';
import { JournalEntriesService } from './journal-entries.service';
import { LedgerNarrativeService } from './ledger-narrative.service';
import { OpeningBalanceRowDto } from './dto/opening-balance-row.dto';
import { OpeningBalancesDataTransferProvider } from './opening-balances-data-transfer.provider';
import { JournalLookupService } from './services/journal-lookup.service';

/**
 * A trial balance brought from the previous system, imported as one opening entry: whole or not
 * at all, balanced to the cent, never over an account a subledger owns, never twice.
 */
describeWithDb('opening balances import', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let organizationId: string;
  let provider: OpeningBalancesDataTransferProvider;
  let context: DataTransferContext;
  let ledgerId: string;
  let journalId: string;
  const posted: Array<{ dto: CreateJournalEntryDto; context: { actorUserId?: string | null; idempotencyKey?: string } }> = [];

  const actor = '22222222-2222-4222-8222-222222222222';
  /** `fecha,cuenta,debito,credito,detalle`, as the import reads a row. */
  const rows = (...lines: string[]): OpeningBalanceRowDto[] =>
    lines.map((line) => {
      const [date, accountCode, debit, credit, description] = line.split(',');
      return Object.assign(new OpeningBalanceRowDto(), {
        date,
        accountCode,
        ...(debit ? { debit: Number(debit) } : {}),
        ...(credit ? { credit: Number(credit) } : {}),
        ...(description ? { description } : {}),
      });
    });
  /** The whole import as the data-transfer service runs it: each row, then the file. */
  const validate = async (dtos: OpeningBalanceRowDto[]) => {
    const refusals = await Promise.all(
      dtos.map((dto) => provider.import.check(dto, context).then(() => null, (error) => error.messageKey as string)),
    );
    return { refusals, file: refusals.every((r) => r === null) ? await provider.import.checkFile(dtos, context) : [] };
  };
  const account = async (code: string, postable = true) => {
    const [row] = await dataSource.query(
      `INSERT INTO accounts (organization_id, code, name, type, category, nature, version, "isPostable")
       VALUES ($1, $2, '{"es":"Cuenta"}', 'ASSET', 'CURRENT_ASSET', 'DEBIT', 1, $3) RETURNING id`,
      [organizationId, code, postable],
    );
    return row.id as string;
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'Apertura');
    await account('1101'); // cash on hand
    await account('1100', false); // a grouping account
    await account('3101'); // capital
    const receivables = await account('1201');
    const bank = await account('1102');
    await dataSource.query(
      `INSERT INTO organization_settings (organization_id, base_currency, default_accounts_receivable_id) VALUES ($1, 'DOP', $2)`,
      [organizationId, receivables],
    );
    await dataSource.query(
      `INSERT INTO bank_accounts (organization_id, name, currency_code, gl_account_id) VALUES ($1, 'Banco', 'DOP', $2)`,
      [organizationId, bank],
    );
    [{ id: ledgerId }] = await dataSource.query(
      `INSERT INTO ledgers (organization_id, name, currency) VALUES ($1, 'Principal', 'DOP') RETURNING id`,
      [organizationId],
    );
    [{ id: journalId }] = await dataSource.query(
      `INSERT INTO journals (organization_id, code, name, type) VALUES ($1, 'GENERAL', 'General', 'GENERAL') RETURNING id`,
      [organizationId],
    );

    // The posting service is the ledger's, with its own suite; here it records what it was asked.
    const journalEntries = {
      createWithManager: async (_manager: unknown, dto: CreateJournalEntryDto, _org: string, context: never) => {
        posted.push({ dto, context });
        return {};
      },
    } as unknown as JournalEntriesService;
    const journals = { requireByCode: async () => ({ id: journalId }) } as unknown as JournalLookupService;
    const narrative = {
      describeAll: async () => ({ entry: 'Asiento de apertura', line: 'Saldo inicial' }),
    } as unknown as LedgerNarrativeService;

    provider = new OpeningBalancesDataTransferProvider(new DataTransferRegistry(), dataSource, journalEntries, journals, narrative);
    context = { organizationId, userId: actor };
  });

  beforeEach(() => {
    posted.length = 0;
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  it('posts the whole file as one opening entry, by the person who imported it', async () => {
    const file = rows('2026-01-01,1101,150000.50,,Caja', '2026-01-01,3101,,150000.50,');
    expect(await validate(file)).toEqual({ refusals: [null, null], file: [] });

    await provider.import.createAll(file, context);

    expect(posted).toHaveLength(1);
    const [{ dto, context: posting }] = posted;
    expect(dto).toMatchObject({
      date: '2026-01-01',
      journalId,
      currencyCode: 'DOP',
      entryType: JournalEntryType.OPENING_BALANCE,
    });
    expect(dto.lines.map((line) => [line.debit, line.credit, line.description])).toEqual([
      [150000.5, 0, 'Caja'],
      [0, 150000.5, 'Saldo inicial'],
    ]);
    expect(posting.actorUserId).toBe(actor);
    expect(posting.idempotencyKey).toMatch(/^opening-balances:[0-9a-f]{40}$/);
  });

  it('refuses a file that does not balance to the cent, or mixes dates', async () => {
    const { file } = await validate(rows('2026-01-01,1101,100.00,,', '2026-01-02,3101,,99.99,'));

    expect(file).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: 1, column: 'fecha', key: 'data_transfer.opening_balances.one_date' }),
        expect.objectContaining({
          key: 'data_transfer.opening_balances.unbalanced',
          params: { debits: 100, credits: 99.99, difference: 0.01 },
        }),
      ]),
    );
  });

  it('names each row that cannot be an opening balance, and why', async () => {
    const { refusals } = await validate(
      rows(
        '2026-01-01,9999,10,,', // no such account
        '2026-01-01,1100,10,,', // a grouping account
        '2026-01-01,1201,10,,', // receivables: from the open invoices
        '2026-01-01,1102,10,,', // a bank account: from its own opening balance
        '2026-01-01,1101,10,10,', // both sides
      ),
    );

    expect(refusals).toEqual([
      'data_transfer.opening_balances.unknown_account',
      'data_transfer.opening_balances.account_not_postable',
      'data_transfer.opening_balances.subledger_receivables',
      'data_transfer.opening_balances.subledger_bank',
      'data_transfer.opening_balances.one_side',
    ]);
  });

  it('will not post the same file twice', async () => {
    await provider.import.createAll(rows('2026-01-01,1101,500,,', '2026-01-01,3101,,500,'), context);
    const key = posted[0].context.idempotencyKey;
    await dataSource.query(
      `INSERT INTO journal_entries (organization_id, ledger_id, journal_id, date, description, entry_number, currency_code, idempotency_key)
       VALUES ($1, $2, $3, '2026-01-01', 'Apertura', 'GENERAL-2026-000001', 'DOP', $4)`,
      [organizationId, ledgerId, journalId, key],
    );

    // The same rows in another order are the same opening balance.
    const { file } = await validate(rows('2026-01-01,3101,,500,', '2026-01-01,1101,500,,'));
    expect(file).toEqual([
      expect.objectContaining({ key: 'data_transfer.opening_balances.already_posted', params: { entry: 'GENERAL-2026-000001' } }),
    ]);
  });
});
