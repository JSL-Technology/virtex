import { DataSource, QueryRunner } from 'typeorm';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { Account } from './entities/account.entity';
import { AccountHistory } from './entities/account-history.entity';
import { AccountCategory, AccountNature, AccountRole, AccountType } from './enums/account-enums';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { JournalQueryService } from '../journal-entries/services/journal-query.service';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * The chart of accounts is one tree, and every account in it says how its foreign-currency balances
 * are measured (FIN-COA-04, FIN-COA-05, FIN-AC-03).
 *
 * The audit found a revenue account (1171) accepted under the assets group 1100, a sub-account
 * (1111) accepted under 1110 — an account with a balance, which kept taking postings — and a
 * `tree/children` endpoint answering with the account itself, because the closure table it read
 * held every account as its own only ancestor. Against the migrated schema: the rules hold in the
 * service, with a message, and in the `accounts_hierarchy_rules` trigger for every other writer.
 */
describeWithDb('the chart of accounts as one tree (FIN-COA-04, FIN-COA-05)', () => {
  jest.setTimeout(60_000);

  let ds: DataSource;
  let organizationId: string;
  let service: ChartOfAccountsService;
  let ledgerId: string;
  let journalId: string;
  /** Every change to an account is recorded in its history under the person who made it. */
  let userId: string;

  const account = (code: string, type: AccountType, isPostable: boolean, extra: Partial<CreateAccountDto> = {}) =>
    service.create(
      {
        segments: [code],
        name: `Cuenta ${code}`,
        type,
        category:
          extra.category ??
          ({
            ASSET: AccountCategory.CURRENT_ASSET,
            LIABILITY: AccountCategory.CURRENT_LIABILITY,
            EQUITY: AccountCategory.OWNERS_EQUITY,
            REVENUE: AccountCategory.OPERATING_REVENUE,
            EXPENSE: AccountCategory.OPERATING_EXPENSE,
          }[type] as AccountCategory),
        nature: type === AccountType.ASSET || type === AccountType.EXPENSE ? AccountNature.DEBIT : AccountNature.CREDIT,
        isPostable,
        ...extra,
      } as CreateAccountDto,
      organizationId,
    );

  const update = (id: string, change: Partial<UpdateAccountDto>) =>
    service.update(id, { reasonForChange: 'Prueba de jerarquía', ...change } as UpdateAccountDto, organizationId, userId);

  /** A posted line on `accountId`, in `currency` (null: the books' currency), with its valuation. */
  const line = (accountId: string, counterpartId: string, currency: string | null) =>
    ds.transaction(async (manager) => {
      const [entry] = await manager.query(
        `INSERT INTO journal_entries (organization_id, ledger_id, journal_id, date, description, status)
         VALUES ($1, $2, $3, CURRENT_DATE, 'Movimiento', 'Draft') RETURNING id`,
        [organizationId, ledgerId, journalId],
      );
      for (const [id, debit, credit, code] of [
        [accountId, 100, 0, currency],
        [counterpartId, 0, 100, null],
      ] as const) {
        const [row] = await manager.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, currency_code) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [entry.id, id, debit, credit, code],
        );
        await manager.query(
          `INSERT INTO journal_entry_line_valuations (journal_entry_line_id, ledger_id, debit, credit) VALUES ($1, $2, $3, $4)`,
          [row.id, ledgerId, debit, credit],
        );
      }
    });

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'coa-hierarchy');
    [{ id: userId }] = await ds.query(`INSERT INTO users ("firstName", "lastName", email) VALUES ('QA', 'Plan', $1) RETURNING id`, [
      `qa-coa-hierarchy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
    ]);
    await ds.query(`INSERT INTO account_segment_definitions (organization_id, name, "order", length, "isRequired") VALUES ($1, 'Cuenta', 1, 4, true)`, [
      organizationId,
    ]);
    await ds.query(`INSERT INTO organization_settings (organization_id, base_currency) VALUES ($1, 'DOP')`, [organizationId]);
    [{ id: ledgerId }] = await ds.query(
      `INSERT INTO ledgers (organization_id, name, currency, is_default) VALUES ($1, 'Principal', 'DOP', true) RETURNING id`,
      [organizationId],
    );
    [{ id: journalId }] = await ds.query(
      `INSERT INTO journals (organization_id, code, name, type) VALUES ($1, 'GENERAL', 'Diario general', 'GENERAL') RETURNING id`,
      [organizationId],
    );
    service = new ChartOfAccountsService(
      ds.getRepository(Account),
      ds.getRepository(AccountHistory),
      ds,
      // Only blocking an account for posting writes to the audit trail; nothing here does.
      { record: jest.fn() } as never,
      new JournalQueryService(ds),
      { add: jest.fn() } as never,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized && organizationId) await ds.query(`DELETE FROM organizations WHERE id = $1`, [organizationId]);
    if (ds?.isInitialized && userId) await ds.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await dropTestOrganization(ds, undefined);
  });

  describe('in the service, with a message that says what to do', () => {
    let assets: Account;
    let cash: Account;
    let banks: Account;

    beforeAll(async () => {
      assets = await account('1100', AccountType.ASSET, false);
      cash = await account('1110', AccountType.ASSET, true, { parentId: undefined });
      await update(cash.id, { parentId: assets.id });
      banks = await account('1120', AccountType.ASSET, false, { parentId: assets.id });
    });

    it('refuses a revenue account under the assets', async () => {
      await expect(account('1171', AccountType.REVENUE, true, { parentId: assets.id })).rejects.toMatchObject({
        messageKey: 'chart_of_accounts.child_type_differs_from_parent',
        params: { code: '1171', parent: '1100', type: 'REVENUE', parentType: 'ASSET' },
      });
    });

    it('refuses a sub-account under an account that takes postings', async () => {
      await expect(account('1111', AccountType.ASSET, true, { parentId: cash.id })).rejects.toMatchObject({
        messageKey: 'chart_of_accounts.parent_takes_postings',
        params: { code: '1111', parent: '1110' },
      });
    });

    it('refuses to let an account with sub-accounts take postings', async () => {
      await expect(update(assets.id, { isPostable: true })).rejects.toMatchObject({
        messageKey: 'chart_of_accounts.account_with_subaccounts_cannot_post',
      });
    });

    it('refuses a loop: an account cannot sit under one of its own sub-accounts', async () => {
      await expect(update(assets.id, { parentId: banks.id })).rejects.toMatchObject({
        messageKey: 'chart_of_accounts.parent_cannot_be_descendant',
      });
      await expect(update(assets.id, { parentId: assets.id })).rejects.toMatchObject({
        messageKey: 'chart_of_accounts.parent_cannot_be_descendant',
      });
    });

    it('answers the sub-accounts of an account, not the account itself (FIN-COA-04)', async () => {
      const children = await service.findChildrenOf(assets.id, organizationId);
      expect(children.map((child) => child.code)).toEqual(['1110', '1120']);
      await expect(service.findChildrenOf(banks.id, organizationId)).resolves.toEqual([]);
    });

    it('keeps an account with movements taking postings: its balance would belong to no one', async () => {
      const expense = await account('6100', AccountType.EXPENSE, true);
      await line(cash.id, expense.id, null);
      await expect(update(cash.id, { isPostable: false })).rejects.toMatchObject({
        messageKey: 'chart_of_accounts.summary_account_cannot_have_movements',
        params: { code: '1110' },
      });
    });
  });

  describe('the foreign-currency settings of an account (FIN-AC-03)', () => {
    it('starts each account with the treatment its type and role call for', async () => {
      const loans = await account('2500', AccountType.LIABILITY, true);
      const debts = await account('2000', AccountType.LIABILITY, false);
      const advances = await account('2300', AccountType.LIABILITY, true, { systemRole: AccountRole.CUSTOMER_ADVANCES });
      const equipment = await account('1500', AccountType.ASSET, true, { category: AccountCategory.NON_CURRENT_ASSET });
      const receivables = await account('1200', AccountType.ASSET, true, { systemRole: AccountRole.ACCOUNTS_RECEIVABLE });

      // A liability is money owed; a summary account has no balance of its own; an advance settled
      // by delivering goods is not money (IFRIC 22); equipment is not; a receivable is.
      expect([loans, debts, advances, equipment, receivables].map((a) => a.fxTreatment)).toEqual([
        'REVALUED',
        'HISTORICAL',
        'HISTORICAL',
        'HISTORICAL',
        'REVALUED',
      ]);
    });

    it('revalues only balance-sheet accounts, in a currency that exists', async () => {
      await expect(account('6200', AccountType.EXPENSE, true, { fxTreatment: 'REVALUED' })).rejects.toMatchObject({
        messageKey: 'chart_of_accounts.revalued_only_balance_sheet',
      });
      await expect(account('1130', AccountType.ASSET, true, { currency: 'ZZZ' })).rejects.toMatchObject({
        messageKey: 'chart_of_accounts.currency_unknown',
        params: { currency: 'ZZZ' },
      });
    });

    it('a summary account has no currency and is not revalued', async () => {
      await expect(account('1300', AccountType.ASSET, false, { currency: 'USD' })).rejects.toMatchObject({
        messageKey: 'chart_of_accounts.summary_account_has_no_currency',
        params: { code: '1300' },
      });
      await expect(account('1301', AccountType.ASSET, false, { fxTreatment: 'REVALUED' })).rejects.toMatchObject({
        messageKey: 'chart_of_accounts.summary_account_has_no_currency',
      });

      // Becoming one, an account without movements gives both up.
      const dollars = await account('1140', AccountType.ASSET, true, { currency: 'USD', fxTreatment: 'REVALUED' });
      const summary = await update(dollars.id, { isPostable: false });
      expect(summary).toMatchObject({ isPostable: false, fxTreatment: 'HISTORICAL', currency: null });
    });

    it('locks an account to a currency only while its lines are all in it', async () => {
      const bank = await account('1150', AccountType.ASSET, true);
      const counterpart = await account('6300', AccountType.EXPENSE, true);
      await line(bank.id, counterpart.id, 'USD');
      await expect(update(bank.id, { currency: 'USD' })).resolves.toMatchObject({ currency: 'USD' });

      const mixed = await account('1160', AccountType.ASSET, true);
      await line(mixed.id, counterpart.id, null);
      await expect(update(mixed.id, { currency: 'USD' })).rejects.toMatchObject({
        messageKey: 'chart_of_accounts.currency_conflicts_with_movements',
        params: { code: '1160', currency: 'USD' },
      });
    });
  });

  /**
   * Every other writer — an import, a provisioning, a script — meets the same rules in the database.
   * Written here as SQL, as such a writer would.
   */
  describe('in the database, for every writer', () => {
    let group: string;
    let leaf: string;

    const insert = async (code: string, type: string, isPostable: boolean, parentId: string | null): Promise<string> => {
      const [row] = await ds.query(
        `INSERT INTO accounts (organization_id, code, name, type, category, nature, "isPostable", version, parent_id)
         VALUES ($1, $2, '{"es":"Cuenta"}'::jsonb, $3, $4, $5, $6, 1, $7) RETURNING id`,
        [
          organizationId,
          code,
          type,
          type === 'ASSET' ? 'CURRENT_ASSET' : 'OPERATING_REVENUE',
          type === 'ASSET' ? 'DEBIT' : 'CREDIT',
          isPostable,
          parentId,
        ],
      );
      return row.id;
    };
    const violation = (constraint: string) => expect.objectContaining({ code: '23514', constraint });

    beforeAll(async () => {
      group = await insert('7100', 'ASSET', false, null);
      leaf = await insert('7110', 'ASSET', true, group);
    });

    it('refuses a child of another type, and a child under an account that takes postings', async () => {
      await expect(insert('7171', 'REVENUE', true, group)).rejects.toEqual(violation('CHK_accounts_child_type_matches_parent'));
      await expect(insert('7111', 'ASSET', true, leaf)).rejects.toEqual(violation('CHK_accounts_parent_is_summary'));
    });

    it('refuses postings on an account with sub-accounts, and a type its sub-accounts do not share', async () => {
      await expect(ds.query(`UPDATE accounts SET "isPostable" = true WHERE id = $1`, [group])).rejects.toEqual(
        violation('CHK_accounts_parent_is_summary'),
      );
      await expect(ds.query(`UPDATE accounts SET type = 'REVENUE', category = 'OPERATING_REVENUE', nature = 'CREDIT' WHERE id = $1`, [group])).rejects.toEqual(
        violation('CHK_accounts_child_type_matches_parent'),
      );
    });

    it('refuses a loop, and an account that is its own parent', async () => {
      const middle = await insert('7120', 'ASSET', false, group);
      const bottom = await insert('7121', 'ASSET', false, middle);
      await expect(ds.query(`UPDATE accounts SET parent_id = $2 WHERE id = $1`, [group, bottom])).rejects.toEqual(
        violation('CHK_accounts_hierarchy_acyclic'),
      );
      await expect(ds.query(`UPDATE accounts SET parent_id = id WHERE id = $1`, [middle])).rejects.toEqual(
        violation('CHK_accounts_hierarchy_acyclic'),
      );
    });

    it('a summary account holds no currency and no revalued treatment', async () => {
      await expect(ds.query(`UPDATE accounts SET currency = 'USD' WHERE id = $1`, [group])).rejects.toEqual(
        violation('CHK_accounts_summary_has_no_currency'),
      );
      await expect(ds.query(`UPDATE accounts SET fx_treatment = 'REVALUED' WHERE id = $1`, [group])).rejects.toEqual(
        violation('CHK_accounts_summary_has_no_currency'),
      );
    });

    /**
     * Each check reads the tree as it stands, so two writers can each pass it alone and break it
     * together. The second waits for the first here — that wait is what the test proves — and then
     * sees what the first committed.
     */
    describe('two writers at once', () => {
      let first: QueryRunner;
      let second: QueryRunner;

      /** The server process behind a connection, to watch it from another. */
      const pidOf = async (runner: QueryRunner): Promise<number> =>
        (await runner.query(`SELECT pg_backend_pid() AS pid`))[0].pid;

      /** Resolves once the connection `pid` waits on a lock: the one the first writer holds. */
      const waitingOnLock = async (pid: number): Promise<void> => {
        for (let attempt = 0; attempt < 200; attempt++) {
          const [row] = await ds.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
          if (row?.wait_event_type === 'Lock') return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('the second writer never waited for the first');
      };

      beforeEach(async () => {
        first = ds.createQueryRunner();
        second = ds.createQueryRunner();
        await first.connect();
        await second.connect();
        await first.startTransaction();
        await second.startTransaction();
      });

      afterEach(async () => {
        for (const runner of [first, second]) {
          if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
          await runner.release();
        }
      });

      it('cannot close a loop together that neither closes alone', async () => {
        const left = await insert('7200', 'ASSET', false, null);
        const right = await insert('7300', 'ASSET', false, null);

        // Each move is sound on the tree as it stands.
        const pid = await pidOf(second);
        await first.query(`UPDATE accounts SET parent_id = $2 WHERE id = $1`, [left, right]);
        const racing = second.query(`UPDATE accounts SET parent_id = $2 WHERE id = $1`, [right, left]);
        racing.catch(() => undefined);
        await waitingOnLock(pid);
        await first.commitTransaction();

        await expect(racing).rejects.toEqual(violation('CHK_accounts_hierarchy_acyclic'));
      });

      it('cannot hang a sub-account under an account that is starting to take postings', async () => {
        const parent = await insert('7400', 'ASSET', false, null);

        const pid = await pidOf(second);
        await first.query(
          `INSERT INTO accounts (organization_id, code, name, type, category, nature, "isPostable", version, parent_id)
           VALUES ($1, '7410', '{"es":"Cuenta"}'::jsonb, 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 1, $2)`,
          [organizationId, parent],
        );
        const racing = second.query(`UPDATE accounts SET "isPostable" = true WHERE id = $1`, [parent]);
        racing.catch(() => undefined);
        await waitingOnLock(pid);
        await first.commitTransaction();

        await expect(racing).rejects.toEqual(violation('CHK_accounts_parent_is_summary'));
      });
    });
  });
});
