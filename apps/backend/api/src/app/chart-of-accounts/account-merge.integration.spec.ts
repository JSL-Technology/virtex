import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import { AccountJobsProcessor } from './account-jobs.processor';
import { JournalQueryService } from '../journal-entries/services/journal-query.service';
import { LedgerPostingRequest } from '../contracts/ledger-posting/ledger-posting.contract';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * Merging an account never rewrites a posted line (FIN-COA-02).
 *
 * The job repointed `journal_entry_lines.account_id` for every line it found. The immutability
 * triggers refuse that for a posted entry, so the merge of any account with a single posted
 * movement failed — after the API had answered 200 and told the person it had started. What a
 * merge does now: drafts are repointed, posted lines stay where they are for ever, and the posted
 * BALANCE moves with a dated reclassification entry.
 *
 * Against the migrated schema with the triggers live, because the triggers are what made the old
 * code impossible and a mocked repository would have let it pass.
 */
describeWithDb('merging an account leaves posted history alone', () => {
  let ds: DataSource;
  let organizationId: string;
  let sourceId: string;
  let destinationId: string;
  let postedLineId: string;
  let draftLineId: string;
  let postedEntryId: string;
  let posted: Array<{ request: LedgerPostingRequest; idempotencyKey?: string }>;
  let processor: AccountJobsProcessor;

  const job = (over: Record<string, unknown> = {}) =>
    ({
      id: 'job-merge-1',
      name: 'merge-accounts',
      data: { dto: { sourceAccountId: sourceId, destinationAccountId: destinationId, reason: 'duplicada' }, organizationId, userId: 'u-1' },
      updateProgress: jest.fn(async () => undefined),
      ...over,
    }) as unknown as Job;

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'account-merge');
    const one = async (sql: string, params: unknown[]) => (await ds.query(sql, params))[0].id as string;

    const account = (code: string, name: string) =>
      one(
        `INSERT INTO accounts (organization_id, code, name, type, category, nature, "isPostable", version)
         VALUES ($1, $2, $3::jsonb, 'EXPENSE', 'OPERATING_EXPENSE', 'DEBIT', true, 1) RETURNING id`,
        [organizationId, code, JSON.stringify({ es: name })],
      );
    sourceId = await account('6200', 'Gastos varios');
    destinationId = await account('6000', 'Gastos generales');

    const ledgerId = await one(
      `INSERT INTO ledgers (organization_id, name, currency, is_default) VALUES ($1, 'Principal', 'DOP', true) RETURNING id`,
      [organizationId],
    );
    const journalId = await one(
      `INSERT INTO journals (organization_id, code, name, type) VALUES ($1, 'GENERAL', 'Diario general', 'GENERAL') RETURNING id`,
      [organizationId],
    );
    // An entry, its two lines and their valuations go in one transaction: the schema defers both
    // the "every line is valued in a ledger" and the "the entry balances" checks to commit.
    const entryWithLines = (status: string, description: string, amount: number) =>
      ds.transaction(async (manager) => {
        const [entry] = await manager.query(
          `INSERT INTO journal_entries (organization_id, ledger_id, journal_id, date, description, status)
           VALUES ($1, $2, $3, CURRENT_DATE, $4, $5) RETURNING id`,
          [organizationId, ledgerId, journalId, description, status],
        );
        const line = async (accountId: string, debit: number, credit: number) => {
          const [row] = await manager.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, $4) RETURNING id`,
            [entry.id, accountId, debit, credit],
          );
          await manager.query(
            `INSERT INTO journal_entry_line_valuations (journal_entry_line_id, ledger_id, debit, credit) VALUES ($1, $2, $3, $4)`,
            [row.id, ledgerId, debit, credit],
          );
          return row.id as string;
        };
        return { entryId: entry.id as string, sourceLineId: await line(sourceId, amount, 0), destinationLineId: await line(destinationId, 0, amount) };
      });

    const postedEntry = await entryWithLines('Posted', 'QA asiento contabilizado', 700);
    postedEntryId = postedEntry.entryId;
    postedLineId = postedEntry.sourceLineId;
    draftLineId = (await entryWithLines('Draft', 'QA asiento borrador', 50)).sourceLineId;

    posted = [];
    const ledger = {
      describeAll: async (_m: unknown, _o: string, words: Record<string, { key: string }>) =>
        Object.fromEntries(Object.entries(words).map(([name, word]) => [name, word.key])),
      post: async (_m: unknown, _o: string, request: LedgerPostingRequest, context: { idempotencyKey?: string }) => {
        posted.push({ request, idempotencyKey: context.idempotencyKey });
        return { id: 'reclass-1' };
      },
    };
    processor = new AccountJobsProcessor(
      ds,
      { sendToUser: jest.fn(async () => undefined) } as never,
      { record: jest.fn(async () => undefined) } as never,
      new JournalQueryService(ds),
      ledger as never,
    );
  });

  afterAll(async () => {
    await dropTestOrganization(ds, organizationId);
  });

  it('the posted line keeps its account, and the draft one moves', async () => {
    await expect(processor.process(job())).resolves.toMatchObject({ messageKey: 'chart_of_accounts.merge_completed' });

    const [stayed] = await ds.query(`SELECT account_id FROM journal_entry_lines WHERE id = $1`, [postedLineId]);
    expect(stayed.account_id).toBe(sourceId);

    const [moved] = await ds.query(`SELECT account_id FROM journal_entry_lines WHERE id = $1`, [draftLineId]);
    expect(moved.account_id).toBe(destinationId);
  });

  it('the posted balance is reclassified instead, squaring the source off against the destination', () => {
    expect(posted).toHaveLength(1);
    const { request, idempotencyKey } = posted[0];
    expect(request.journalCode).toBe('GENERAL');
    // The source carried a net debit of 700 (the draft is not in the ledger), so it is credited.
    expect(request.lines).toEqual([
      { accountId: sourceId, debit: 0, credit: 700 },
      { accountId: destinationId, debit: 700, credit: 0 },
    ]);
    // Three queue attempts, one entry.
    expect(idempotencyKey).toBe('account-merge:job-merge-1');
  });

  it('the source is closed and blocked, not deleted: its history is still addressable', async () => {
    const [source] = await ds.query(
      `SELECT "isActive", is_blocked_for_posting, description FROM accounts WHERE id = $1`,
      [sourceId],
    );
    expect(source.isActive).toBe(false);
    expect(source.is_blocked_for_posting).toBe(true);
    expect(source.description.es).toContain('→ 6000');

    const [{ count }] = await ds.query(`SELECT COUNT(*)::int AS count FROM journal_entry_lines WHERE journal_entry_id = $1`, [postedEntryId]);
    expect(count).toBe(2);
  });
});
