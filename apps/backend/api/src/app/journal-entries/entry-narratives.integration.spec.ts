import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { localizedNameIn, renderNarrative, type NarrativeRef } from '@virtex/shared/types';
import { testExchangeRateResolver } from '../currencies/exchange-rate-resolver.testing';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Journal } from './entities/journal.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { AccountCategory, AccountNature, AccountType } from '../chart-of-accounts/enums/account-enums';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryAttachment } from './entities/journal-entry-attachment.entity';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntryNumberingService } from './journal-entry-numbering.service';
import { LedgerNarrativeService } from './ledger-narrative.service';
import { JournalQueryService } from './services/journal-query.service';
import { I18nService } from '../i18n/i18n.service';
import { described } from '../contracts/ledger-posting/ledger-text';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * The narratives the system writes, as the books record them and as another reader reads them
 * (books bilingual, part 2).
 *
 * A Dominican company's books are in Spanish — what the DGII and an auditor read — and its
 * controller reads English. Each system narrative is written once, in the books language, and kept
 * beside the message it came from: the record never changes, and a screen in another language
 * renders the message. Here, against the migrated schema: what is stored, what a reversal nests,
 * what the database refuses, what the ledger hands the screen, and what an English reader reads.
 */
describeWithDb('system narratives: the record in the books language, the message beside it', () => {
  jest.setTimeout(120_000);

  const DATE = '2026-06-10';
  const ACTOR = '55555555-5555-4555-8555-555555555555';
  /** An account's name as the chart keeps it now: the books language and the translations. */
  const CHARGES_NAME = { es: 'Gastos bancarios', en: 'Bank charges', pt: 'Despesas bancárias' };

  let ds: DataSource;
  let organizationId: string;
  let journalId: string;
  let ledgerId: string;
  let bank: string;
  let charges: string;
  let entries: JournalEntriesService;
  const i18n = new I18nService();
  const narrative = new LedgerNarrativeService(i18n);

  /** A stored narrative, rendered as a screen in `language` renders it (the client's rules). */
  const readIn = (language: 'en' | 'pt', ref: NarrativeRef) =>
    renderNarrative(ref, {
      message: (key, values) => (i18n.has(key) ? i18n.translate(key, language, values) : null),
      name: (name) => localizedNameIn(name, language, 'es'),
    });

  const stored = async (table: 'journal_entries' | 'journal_entry_lines', where: string, values: unknown[]) =>
    ds.query(`SELECT description, description_key AS key, description_params AS params FROM ${table} WHERE ${where}`, values);

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'narratives');
    await ds.query(`UPDATE organizations SET books_language = 'es' WHERE id = $1`, [organizationId]);
    ledgerId = (
      await ds.getRepository(Ledger).save(
        ds.getRepository(Ledger).create({ organizationId, name: 'Principal', currency: 'DOP', isDefault: true, isActive: true }),
      )
    ).id;
    journalId = (await ds.getRepository(Journal).save({ organizationId, code: 'GENERAL', name: 'Diario general', type: 'GENERAL' as const })).id;
    const account = async (code: string, name: Record<string, string>, type: AccountType, category: AccountCategory, nature: AccountNature) =>
      (
        await ds.getRepository(Account).save(
          ds.getRepository(Account).create({ organizationId, code, name, type, category, nature, isPostable: true, isActive: true }),
        )
      ).id;
    bank = await account('1101', { es: 'Banco', en: 'Bank' }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT);
    charges = await account('6105', CHARGES_NAME, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);
    await ds.query(`INSERT INTO organization_settings (organization_id, base_currency) VALUES ($1, 'DOP')`, [organizationId]);

    entries = new JournalEntriesService(
      ds.getRepository(JournalEntry),
      ds.getRepository(JournalEntryAttachment),
      ds,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null), announcePending: jest.fn() } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      // The audit trail is configuration's: what it records is not what this suite is about.
      { recordWithManager: jest.fn().mockResolvedValue(undefined) } as never,
      testExchangeRateResolver(ds),
      undefined,
      narrative,
    );
  });

  afterAll(async () => {
    await dropTestOrganization(ds, organizationId);
  });

  /** What a bank reconciliation posts for a charge the books did not have yet. */
  const postCharge = async () => {
    const words = await narrative.describeAll(ds.manager, organizationId, {
      header: {
        key: 'ledger.adjustment.period_end',
        params: { type: 'ledger.adjustment_type.accrual', description: 'Comisión de mantenimiento' },
      },
      // The account's name as it is kept — `{ es, en, pt }` — which used to print «[object Object]».
      category: { key: 'ledger.reconciliation.category_line', params: { account: CHARGES_NAME } },
    });
    return ds.transaction((manager) =>
      entries.createWithManager(
        manager,
        {
          date: DATE,
          ...described(words.header),
          journalId,
          lines: [
            { accountId: charges, debit: 150, credit: 0, ...described(words.category) },
            { accountId: bank, debit: 0, credit: 150 },
          ],
        } as CreateJournalEntryDto,
        organizationId,
        { actorUserId: ACTOR, systemReason: 'bank-category' } as never,
      ),
    );
  };

  it('records the narrative in the books language and keeps the message it came from', async () => {
    const entry = await postCharge();

    const [header] = await stored('journal_entries', 'id = $1', [entry.id]);
    expect(header).toEqual({
      description: 'Ajuste de fin de período (devengo): Comisión de mantenimiento',
      key: 'ledger.adjustment.period_end',
      params: { type: 'ledger.adjustment_type.accrual', description: 'Comisión de mantenimiento' },
    });
    const [line] = await stored('journal_entry_lines', 'journal_entry_id = $1 AND account_id = $2', [entry.id, charges]);
    expect(line).toEqual({
      description: 'Categoría: Gastos bancarios',
      key: 'ledger.reconciliation.category_line',
      params: { account: CHARGES_NAME },
    });

    // An English reader reads the same narrative in English; what a person typed stays as typed.
    expect(readIn('en', header)).toBe('Period-end adjustment (accrual): Comisión de mantenimiento');
    expect(readIn('en', line)).toBe('Category: Bank charges');
    expect(readIn('pt', line)).toBe('Categoria: Despesas bancárias');
  });

  it('never stores an object where a name belongs', async () => {
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE e.organization_id = $1 AND (l.description LIKE '%[object Object]%' OR e.description LIKE '%[object Object]%')`,
      [organizationId],
    );
    expect(n).toBe(0);
  });

  it('nests the original narrative in its reversal, so the reversal reads in the reader language too', async () => {
    const entry = await postCharge();
    const reversal = await ds.transaction((manager) =>
      entries.createSystemReversal(entry.id, organizationId, { reversalDate: DATE, reason: 'Cargo duplicado' }, manager, {
        actorUserId: ACTOR,
        systemReason: 'bank-category-undo',
      } as never),
    );

    const [header] = await stored('journal_entries', 'id = $1', [reversal.id]);
    expect(header.key).toBe('ledger.reversal.entry');
    expect(header.description).toBe(`Reversión de ${entry.entryNumber}. Razón: Cargo duplicado`);
    expect(readIn('en', header)).toBe(`Reversal of ${entry.entryNumber}. Reason: Cargo duplicado`);

    const [line] = await stored('journal_entry_lines', 'journal_entry_id = $1 AND account_id = $2', [reversal.id, charges]);
    expect(line.description).toBe('Reversión: Categoría: Gastos bancarios');
    expect(line.params).toEqual({ line: { key: 'ledger.reconciliation.category_line', params: { account: CHARGES_NAME } } });
    expect(readIn('en', line)).toBe('Reversal: Category: Bank charges');

    // The bank line had no narrative of its own: its reversal nests the entry's.
    const [bankLine] = await stored('journal_entry_lines', 'journal_entry_id = $1 AND account_id = $2', [reversal.id, bank]);
    expect(bankLine.params.line).toMatchObject({ key: 'ledger.adjustment.period_end' });
    expect(readIn('en', bankLine)).toBe('Reversal: Period-end adjustment (accrual): Comisión de mantenimiento');
  });

  it('keeps no message on what a person typed: it is only text, in every language', async () => {
    const entry = await entries.create(
      {
        date: DATE,
        description: 'Pago de luz',
        journalId,
        lines: [
          { accountId: charges, debit: 80, credit: 0, description: 'Factura EDESUR' },
          { accountId: bank, debit: 0, credit: 80 },
        ],
      } as CreateJournalEntryDto,
      organizationId,
      { actorUserId: ACTOR } as never,
    );
    const [header] = await stored('journal_entries', 'id = $1', [entry.id]);
    expect(header).toEqual({ description: 'Pago de luz', key: null, params: null });
    const lines = await stored('journal_entry_lines', 'journal_entry_id = $1', [entry.id]);
    expect(lines.every((line: { key: unknown; params: unknown }) => line.key === null && line.params === null)).toBe(true);
  });

  it('refuses, in the database, a message without its values or values without a message', async () => {
    const entry = await postCharge();
    await expect(ds.query(`UPDATE journal_entries SET description_params = NULL WHERE id = $1`, [entry.id])).rejects.toThrow(
      /CHK_journal_entries_description_narrative/,
    );
    await expect(
      ds.query(`UPDATE journal_entry_lines SET description_key = NULL WHERE journal_entry_id = $1 AND account_id = $2`, [entry.id, charges]),
    ).rejects.toThrow(/CHK_journal_entry_lines_description_narrative/);
  });

  it('refuses a message that is no catalogue key, and values that are not named', async () => {
    const entry = await postCharge();
    // A sentence where the key goes: nothing could render it, so nothing may store it.
    await expect(ds.query(`UPDATE journal_entries SET description_key = 'Pago de luz' WHERE id = $1`, [entry.id])).rejects.toThrow(
      /CHK_journal_entries_description_narrative/,
    );
    // Values by position, or a bare value: a message interpolates them by name.
    await expect(ds.query(`UPDATE journal_entries SET description_params = '["Intereses"]'::jsonb WHERE id = $1`, [entry.id])).rejects.toThrow(
      /CHK_journal_entries_description_narrative/,
    );
    await expect(
      ds.query(`UPDATE journal_entry_lines SET description_params = '"Bancos"'::jsonb WHERE journal_entry_id = $1 AND account_id = $2`, [entry.id, charges]),
    ).rejects.toThrow(/CHK_journal_entry_lines_description_narrative/);
  });

  it('hands the ledger the message of whichever narrative it shows — the line’s, or the entry’s', async () => {
    const entry = await postCharge();
    const { rows } = await new JournalQueryService(ds).getGeneralLedgerLines({
      organizationId,
      accountId: bank,
      ledgerId,
      from: DATE,
      to: DATE,
      page: 1,
      pageSize: 500,
    });
    const row = rows.find((candidate) => candidate.journalEntryId === entry.id);
    // The bank line has no narrative: the entry's is the one shown, and its message travels with it.
    expect(row).toMatchObject({
      lineDescription: null,
      lineDescriptionKey: null,
      entryDescription: 'Ajuste de fin de período (devengo): Comisión de mantenimiento',
      entryDescriptionKey: 'ledger.adjustment.period_end',
      entryDescriptionParams: { type: 'ledger.adjustment_type.accrual', description: 'Comisión de mantenimiento' },
    });

    const charge = (
      await new JournalQueryService(ds).getGeneralLedgerLines({ organizationId, accountId: charges, ledgerId, from: DATE, to: DATE, page: 1, pageSize: 500 })
    ).rows.find((candidate) => candidate.journalEntryId === entry.id);
    expect(charge).toMatchObject({
      lineDescription: 'Categoría: Gastos bancarios',
      lineDescriptionKey: 'ledger.reconciliation.category_line',
      lineDescriptionParams: { account: CHARGES_NAME },
    });
  });
});
