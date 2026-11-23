import { ChartOfAccountsService } from './chart-of-accounts.service';
import { AccountType } from './enums/account-enums';

/**
 * The merge wizard used to show invented figures — «42 transactions» for every pair of accounts —
 * and the server learnt of a refused merge only once it was asked to perform it. The preview says,
 * from the tenant's own ledger, what would move and every reason the merge would be refused.
 */
describe('ChartOfAccountsService — vista previa de fusión', () => {
  const account = (over: Record<string, unknown> = {}) => ({
    id: 'a-1',
    code: '1101',
    name: { es: 'Caja chica' },
    type: AccountType.ASSET,
    isPostable: true,
    isSystemAccount: false,
    isActive: true,
    ...over,
  });

  /** A summary as `JournalQueryService` answers it: posted history and drafts told apart. */
  const summary = (over: Partial<{ lines: number; postedBalance: number; linesInClosedPeriods: number; postedLines: number }> = {}) => {
    const lines = over.lines ?? 0;
    const postedLines = over.postedLines ?? lines;
    return {
      lines,
      postedBalance: over.postedBalance ?? 0,
      linesInClosedPeriods: over.linesInClosedPeriods ?? 0,
      postedLines,
      unpostedLines: lines - postedLines,
    };
  };

  const build = (source: unknown, destination: unknown, movements = summary()) => {
    const repository = {
      findOne: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'a-1' ? source : where.id === 'a-2' ? destination : null),
      ),
      count: jest.fn(() => Promise.resolve(0)),
    };
    const journalQuery = {
      summarizeAccountMovements: jest.fn((id: string) =>
        Promise.resolve(id === 'a-1' ? movements : summary({ lines: 3, postedBalance: 900 })),
      ),
    };
    const queue = { add: jest.fn(() => Promise.resolve({ id: 'job-1' })) };
    const service = new ChartOfAccountsService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      journalQuery as never,
      queue as never,
    );
    return { service, queue };
  };

  it('separates the drafts it will move from the history it will not', async () => {
    // Ten of the twelve are in the ledger: those stay, and their balance is reclassified. The two
    // that are still drafts are repointed, because a draft is not history.
    const { service } = build(
      account(),
      account({ id: 'a-2', code: '1102' }),
      summary({ lines: 12, postedLines: 10, postedBalance: 1500.75 }),
    );

    const preview = await service.previewMerge('a-1', 'a-2', 'org-1');

    expect(preview.linesToMove).toBe(2);
    expect(preview.postedLinesKept).toBe(10);
    expect(preview.reclassifiedAmount).toBe(1500.75);
    expect(preview.source.postedBalance).toBe(1500.75);
    expect(preview.destination.postedBalance).toBe(900);
    expect(preview.blockers).toEqual([]);
    expect(preview.warnings).toEqual(['chart_of_accounts.merge_reclassifies_posted_balance']);
  });

  it('an account with nothing posted is merged with no entry at all', async () => {
    const { service } = build(account(), account({ id: 'a-2' }), summary({ lines: 4, postedLines: 0 }));

    const preview = await service.previewMerge('a-1', 'a-2', 'org-1');

    expect(preview.linesToMove).toBe(4);
    expect(preview.postedLinesKept).toBe(0);
    expect(preview.reclassifiedAmount).toBe(0);
    expect(preview.warnings).toEqual([]);
  });

  it('refuses to fold one account type into another', async () => {
    //  An asset merged into an expense would move its whole history from the balance sheet to the
    //  income statement, closed years included.
    const { service, queue } = build(account(), account({ id: 'a-2', type: AccountType.EXPENSE }));

    const preview = await service.previewMerge('a-1', 'a-2', 'org-1');
    expect(preview.blockers).toContain('chart_of_accounts.merge_types_must_match');

    await expect(
      service.merge({ sourceAccountId: 'a-1', destinationAccountId: 'a-2', reason: 'x' }, 'org-1', 'u-1'),
    ).rejects.toBeDefined();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('refuses an inactive destination and a system source', async () => {
    const { service } = build(account({ isSystemAccount: true }), account({ id: 'a-2', isActive: false }));

    const preview = await service.previewMerge('a-1', 'a-2', 'org-1');

    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        'chart_of_accounts.system_accounts_cannot_merged',
        'chart_of_accounts.merge_destination_inactive',
      ]),
    );
  });

  it('a closed period is never rewritten, so it is no longer a warning about moving lines', async () => {
    // It used to warn that lines in closed periods WOULD MOVE, which is what the job then failed
    // trying to do. Nothing moves: the warning now says what really happens to the balance.
    const { service } = build(
      account(),
      account({ id: 'a-2' }),
      summary({ lines: 40, postedBalance: 10, linesInClosedPeriods: 25 }),
    );

    const preview = await service.previewMerge('a-1', 'a-2', 'org-1');

    expect(preview.blockers).toEqual([]);
    expect(preview.warnings).toEqual(['chart_of_accounts.merge_reclassifies_posted_balance']);
    expect(preview.linesInClosedPeriods).toBe(25);
    expect(preview.postedLinesKept).toBe(40);
    expect(preview.linesToMove).toBe(0);
  });

  it('queues an allowed merge and answers with a translatable message', async () => {
    const { service, queue } = build(account(), account({ id: 'a-2', code: '1102' }));

    const result = await service.merge(
      { sourceAccountId: 'a-1', destinationAccountId: 'a-2', reason: 'Duplicada' },
      'org-1',
      'u-1',
    );

    expect(queue.add).toHaveBeenCalledWith('merge-accounts', expect.anything(), expect.anything());
    expect(result).toEqual({
      jobId: 'job-1',
      messageKey: 'chart_of_accounts.merge_started',
      messageParams: { source: '1101', destination: '1102' },
    });
  });
});
