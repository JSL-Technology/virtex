import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Organization } from '../organizations/entities/organization.entity';
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
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { JournalEntryNumberingService } from '../journal-entries/journal-entry-numbering.service';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { BankAccount, BankAccountType } from '../treasury/entities/bank-account.entity';
import { ReconciliationService } from './reconciliation.service';
import { CsvParserService } from './parsers/csv-parser.service';
import { BankStatement, StatementStatus } from './entities/bank-statement.entity';
import { BankTransaction, TransactionStatus } from './entities/bank-transaction.entity';
import { ReconciliationMatch } from './entities/reconciliation-match.entity';
import { ReconciliationRule, RuleAction, RuleConditionField, RuleConditionOperator, RuleDirection } from './entities/reconciliation-rule.entity';
import { FastifyFile } from '../common/interfaces/fastify-file.interface';

/**
 * Bank reconciliation.
 *
 * The first assertion below is the one the audit was written for: the module used to **post a new
 * journal entry** for every rule match and then reconcile the statement line against the line it
 * had just created, double-counting every receipt and payment the bank confirmed. The rest cover
 * what a reconciliation is actually made of and none of which existed: many-to-many matching, the
 * balance proof, closure, and the tenant boundary on the ledger line being cleared.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('bank reconciliation', () => {
  jest.setTimeout(180_000);

  let dataSource: DataSource;
  let reconciliation: ReconciliationService;
  let entries: JournalEntriesService;

  let organizationId: string;
  let ledgerId: string;
  let bankAccountId: string;
  let journalId: string;
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

    const audit = new AuditTrailService(dataSource.getRepository(AuditLog));
    const balances = new AccountBalancesService(dataSource);
    entries = new JournalEntriesService(
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

    reconciliation = new ReconciliationService(
      dataSource.getRepository(BankStatement),
      dataSource.getRepository(BankTransaction),
      dataSource.getRepository(ReconciliationRule),
      new CsvParserService(),
      entries,
      balances,
      dataSource,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `REC ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      { organizationId, code: 'BANCOS', name: 'Bancos', type: 'BANK' as const },
      { organizationId, code: 'CONCIL', name: 'Conciliación', type: 'GENERAL' as const },
    ]);
    journalId = journals[0].id;

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

    await make('bank', '1102', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.BANK);
    await make('receivable', '1103', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT);
    await make('fees', '5210', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);

    await dataSource.getRepository(AccountingPeriod).save([
      { organizationId, name: 'Marzo 2026', startDate: '2026-03-01' as unknown as Date, endDate: '2026-03-31' as unknown as Date, status: PeriodStatus.OPEN },
    ]);

    const bankAccount = await dataSource.getRepository(BankAccount).save(
      dataSource.getRepository(BankAccount).create({
        organizationId,
        name: 'Popular corriente',
        accountNumber: `790${Date.now()}`.slice(0, 20),
        accountType: BankAccountType.CHECKING,
        currencyCode: 'DOP',
        glAccountId: account['bank'],
      }),
    );
    bankAccountId = bankAccount.id;
  });

  afterEach(async () => {
    await dataSource
      .getRepository(Organization)
      .delete({ id: organizationId });
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Post `amount` into (positive) or out of (negative) the bank account. */
  const postToBank = async (date: string, amount: number, description: string) => {
    const entry = await dataSource.transaction((manager) =>
      entries.createWithManager(
        manager,
        {
          date,
          description,
          journalId,
          lines: [
            {
              accountId: account['bank'],
              debit: amount > 0 ? amount : 0,
              credit: amount < 0 ? -amount : 0,
              description,
              valuations: [
                {
                  ledgerId,
                  debit: amount > 0 ? amount : 0,
                  credit: amount < 0 ? -amount : 0,
                },
              ],
            },
            {
              accountId: account['receivable'],
              debit: amount < 0 ? -amount : 0,
              credit: amount > 0 ? amount : 0,
              description,
              valuations: [
                {
                  ledgerId,
                  debit: amount < 0 ? -amount : 0,
                  credit: amount > 0 ? amount : 0,
                },
              ],
            },
          ],
        } as never,
        organizationId,
        { actorUserId: ACTOR, systemReason: 'test' },
      ),
    );
    const line = entry.lines.find((candidate) => candidate.accountId === account['bank']);
    return { entry, lineId: line!.id };
  };

  const importCsv = (
    body: string,
    overrides: Record<string, unknown> = {},
  ): Promise<BankStatement> =>
    reconciliation.importStatement(
      {
        originalname: 'estado.csv',
        buffer: Buffer.from(body, 'utf-8'),
        mimetype: 'text/csv',
      } as FastifyFile,
      {
        bankAccountId,
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        startingBalance: 0,
        endingBalance: 0,
        dateColumn: 'Fecha',
        descriptionColumn: 'Concepto',
        debitColumn: 'Entrada',
        creditColumn: 'Salida',
        dateFormat: 'dd/MM/yyyy',
        decimalSeparator: '.',
        ...overrides,
      } as never,
      organizationId,
      ACTOR,
    );

  const CSV_ONE_DEPOSIT = [
    'Fecha,Concepto,Entrada,Salida',
    '05/03/2026,Deposito cliente Perez,10000.00,',
  ].join('\n');

  // ── import ─────────────────────────────────────────────────────────────────

  describe('import', () => {
    it('loads the statement against a bank account, not a control account', async () => {
      const statement = await importCsv(CSV_ONE_DEPOSIT, { endingBalance: 10_000 });

      expect(statement.bankAccountId).toBe(bankAccountId);
      expect(statement.status).toBe(StatementStatus.IMPORTED);
      expect(statement.transactions).toHaveLength(1);
      expect(statement.transactions[0]).toMatchObject({
        date: '2026-03-05',
        debit: 10_000,
        credit: 0,
        status: TransactionStatus.UNMATCHED,
      });
    });

    it('refuses the same file twice', async () => {
      await importCsv(CSV_ONE_DEPOSIT, { endingBalance: 10_000 });
      await expect(importCsv(CSV_ONE_DEPOSIT, { endingBalance: 10_000 })).rejects.toThrow();
    });

    it('records why an import failed rather than reporting success', async () => {
      await expect(
        importCsv(
          ['Fecha,Concepto,Entrada,Salida', 'ayer,Deposito,10000.00,'].join('\n'),
        ),
      ).rejects.toThrow();

      const failed = await dataSource
        .getRepository(BankStatement)
        .findOneByOrFail({ organizationId });
      expect(failed.status).toBe(StatementStatus.FAILED);
      expect(failed.importError).toContain('INVALID_DATE');
    });

    it('refuses transactions outside the statement range', async () => {
      await expect(
        importCsv(
          ['Fecha,Concepto,Entrada,Salida', '05/04/2026,Deposito,10000.00,'].join('\n'),
        ),
      ).rejects.toThrow();
    });

    it('refuses a bank account belonging to another tenant', async () => {
      const other = await dataSource.getRepository(Organization).save(
        dataSource.getRepository(Organization).create({
          legalName: `REC other ${Date.now()}`,
          timezone: 'America/Santo_Domingo',
        }),
      );
      await expect(
        reconciliation.importStatement(
          {
            originalname: 'ajeno.csv',
            buffer: Buffer.from(CSV_ONE_DEPOSIT, 'utf-8'),
            mimetype: 'text/csv',
          } as FastifyFile,
          {
            bankAccountId,
            startDate: '2026-03-01',
            endDate: '2026-03-31',
            startingBalance: 0,
            endingBalance: 10_000,
            dateColumn: 'Fecha',
            descriptionColumn: 'Concepto',
            debitColumn: 'Entrada',
            creditColumn: 'Salida',
            dateFormat: 'dd/MM/yyyy',
          } as never,
          other.id,
          ACTOR,
        ),
      ).rejects.toThrow();
      await dataSource.getRepository(Organization).delete({ id: other.id });
    });
  });

  // ── the double-counting bug ────────────────────────────────────────────────

  describe('rules', () => {
    it('does not post a second entry for a movement the ledger already carries', async () => {
      await postToBank('2026-03-05', 10_000, 'Cobro cliente Perez');

      await reconciliation.createRule(
        {
          name: 'Depósitos de clientes',
          conditionField: RuleConditionField.DESCRIPTION,
          conditionOperator: RuleConditionOperator.CONTAINS,
          conditionValue: 'deposito',
          action: RuleAction.MATCH_EXISTING,
        } as never,
        organizationId,
      );

      const before = await dataSource
        .getRepository(JournalEntry)
        .count({ where: { organizationId } });

      const statement = await importCsv(CSV_ONE_DEPOSIT, { endingBalance: 10_000 });

      const after = await dataSource
        .getRepository(JournalEntry)
        .count({ where: { organizationId } });

      // The old implementation posted an entry per rule match. One deposit, recorded once, would
      // have become two: cash 20,000 against a real balance of 10,000.
      expect(after).toBe(before);

      const transactions = await dataSource
        .getRepository(BankTransaction)
        .find({ where: { statementId: statement.id } });
      expect(transactions[0].status).toBe(TransactionStatus.MATCHED);
    });

    it('posts the entry the books are missing for a charge the bank originated', async () => {
      await reconciliation.createRule(
        {
          name: 'Comisiones bancarias',
          conditionField: RuleConditionField.DESCRIPTION,
          conditionOperator: RuleConditionOperator.CONTAINS,
          conditionValue: 'comision',
          direction: RuleDirection.MONEY_OUT,
          action: RuleAction.CREATE_ENTRY,
          targetAccountId: account['fees'],
        } as never,
        organizationId,
      );

      const statement = await importCsv(
        ['Fecha,Concepto,Entrada,Salida', '31/03/2026,Comision por mantenimiento,,350.00'].join(
          '\n',
        ),
        { endingBalance: -350 },
      );

      const balances = new AccountBalancesService(dataSource);
      const all = await balances.balancesAsOf({
        organizationId,
        ledgerId,
        asOf: '2026-03-31',
      });
      expect(all.get(account['bank'])).toBe(-350);
      expect(all.get(account['fees'])).toBe(350);

      const transactions = await dataSource
        .getRepository(BankTransaction)
        .find({ where: { statementId: statement.id } });
      expect(transactions[0].status).toBe(TransactionStatus.MATCHED);
    });

    it('will not create an entry when a candidate already exists, whatever the rule says', async () => {
      await postToBank('2026-03-31', -350, 'Comisión bancaria ya registrada');

      await reconciliation.createRule(
        {
          name: 'Comisiones bancarias',
          conditionField: RuleConditionField.DESCRIPTION,
          conditionOperator: RuleConditionOperator.CONTAINS,
          conditionValue: 'comision',
          action: RuleAction.CREATE_ENTRY,
          targetAccountId: account['fees'],
        } as never,
        organizationId,
      );

      await importCsv(
        ['Fecha,Concepto,Entrada,Salida', '31/03/2026,Comision por mantenimiento,,350.00'].join(
          '\n',
        ),
        { endingBalance: -350 },
      );

      const balances = new AccountBalancesService(dataSource);
      const all = await balances.balancesAsOf({ organizationId, ledgerId, asOf: '2026-03-31' });
      // Matched against the existing line, not doubled.
      expect(all.get(account['bank'])).toBe(-350);
      expect(all.get(account['fees']) ?? 0).toBe(0);
    });

    it('refuses a CREATE_ENTRY rule with no target account', async () => {
      await expect(
        reconciliation.createRule(
          {
            name: 'Sin cuenta',
            conditionField: RuleConditionField.DESCRIPTION,
            conditionOperator: RuleConditionOperator.CONTAINS,
            conditionValue: 'x',
            action: RuleAction.CREATE_ENTRY,
          } as never,
          organizationId,
        ),
      ).rejects.toThrow();
    });

    it('refuses a target account from another tenant', async () => {
      const other = await dataSource.getRepository(Organization).save(
        dataSource.getRepository(Organization).create({
          legalName: `REC other ${Date.now()}`,
          timezone: 'America/Santo_Domingo',
        }),
      );
      const foreign = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId: other.id,
          code: '5210',
          name: { es: 'Comisiones ajenas' },
          type: AccountType.EXPENSE,
          category: AccountCategory.OPERATING_EXPENSE,
          nature: AccountNature.DEBIT,
          isPostable: true,
          isActive: true,
        }),
      );

      await expect(
        reconciliation.createRule(
          {
            name: 'Cuenta ajena',
            conditionField: RuleConditionField.DESCRIPTION,
            conditionOperator: RuleConditionOperator.CONTAINS,
            conditionValue: 'x',
            action: RuleAction.CREATE_ENTRY,
            targetAccountId: foreign.id,
          } as never,
          organizationId,
        ),
      ).rejects.toThrow();

      await dataSource.getRepository(Organization).delete({ id: other.id });
    });
  });

  // ── matching ───────────────────────────────────────────────────────────────

  describe('matching', () => {
    it('clears several ledger lines against one deposit', async () => {
      const a = await postToBank('2026-03-04', 4_000, 'Cheque 1001');
      const b = await postToBank('2026-03-04', 6_000, 'Cheque 1002');

      const statement = await importCsv(
        ['Fecha,Concepto,Entrada,Salida', '05/03/2026,Deposito multiple,10000.00,'].join('\n'),
        { endingBalance: 10_000 },
      );
      // The automatic pass leaves it alone: no single line explains 10,000.
      expect(statement.transactions[0].status).toBe(TransactionStatus.UNMATCHED);

      const suggestions = await reconciliation.suggestMatches(statement.id, organizationId);
      expect(suggestions[0].candidates).toHaveLength(0);
      expect(suggestions[0].candidateGroups[0].journalEntryLineIds.sort()).toEqual(
        [a.lineId, b.lineId].sort(),
      );

      const match = await reconciliation.confirmMatch(
        {
          statementId: statement.id,
          bankTransactionIds: [statement.transactions[0].id],
          journalEntryLineIds: [a.lineId, b.lineId],
        } as never,
        organizationId,
        ACTOR,
      );

      expect(match.amount).toBe(10_000);
      const lines = await dataSource
        .getRepository(JournalEntryLine)
        .findBy({ id: a.lineId });
      expect(lines[0].isReconciled).toBe(true);
      expect(lines[0].reconciledAt).toBeInstanceOf(Date);
    });

    it('refuses a match whose two sides do not agree', async () => {
      const a = await postToBank('2026-03-04', 4_000, 'Cheque 1001');
      const statement = await importCsv(
        ['Fecha,Concepto,Entrada,Salida', '05/03/2026,Deposito multiple,10000.00,'].join('\n'),
        { endingBalance: 10_000 },
      );

      await expect(
        reconciliation.confirmMatch(
          {
            statementId: statement.id,
            bankTransactionIds: [statement.transactions[0].id],
            journalEntryLineIds: [a.lineId],
          } as never,
          organizationId,
          ACTOR,
        ),
      ).rejects.toThrow();
    });

    it("refuses to touch another tenant's ledger line", async () => {
      const other = await dataSource.getRepository(Organization).save(
        dataSource.getRepository(Organization).create({
          legalName: `REC other ${Date.now()}`,
          timezone: 'America/Santo_Domingo',
        }),
      );
      const otherLedger = await dataSource.getRepository(Ledger).save(
        dataSource.getRepository(Ledger).create({
          organizationId: other.id,
          name: 'Principal',
          currency: 'DOP',
          isDefault: true,
          isActive: true,
        }),
      );
      const otherJournal = await dataSource
        .getRepository(Journal)
        .save({ organizationId: other.id, code: 'BANCOS', name: 'Bancos', type: 'BANK' as const });
      const otherAccounts = await dataSource.getRepository(Account).save([
        {
          organizationId: other.id,
          code: '1102',
          name: { es: 'Banco ajeno' },
          type: AccountType.ASSET,
          category: AccountCategory.CURRENT_ASSET,
          nature: AccountNature.DEBIT,
          isPostable: true,
          isActive: true,
        },
        {
          organizationId: other.id,
          code: '4101',
          name: { es: 'Ingresos ajenos' },
          type: AccountType.REVENUE,
          category: AccountCategory.OPERATING_REVENUE,
          nature: AccountNature.CREDIT,
          isPostable: true,
          isActive: true,
        },
      ]);
      await dataSource.getRepository(AccountingPeriod).save({
        organizationId: other.id,
        name: 'Marzo 2026',
        startDate: '2026-03-01' as unknown as Date,
        endDate: '2026-03-31' as unknown as Date,
        status: PeriodStatus.OPEN,
      });

      const foreignEntry = await dataSource.transaction((manager) =>
        entries.createWithManager(
          manager,
          {
            date: '2026-03-05',
            description: 'Cobro ajeno',
            journalId: otherJournal.id,
            lines: [
              {
                accountId: otherAccounts[0].id,
                debit: 10_000,
                credit: 0,
                valuations: [{ ledgerId: otherLedger.id, debit: 10_000, credit: 0 }],
              },
              {
                accountId: otherAccounts[1].id,
                debit: 0,
                credit: 10_000,
                valuations: [{ ledgerId: otherLedger.id, debit: 0, credit: 10_000 }],
              },
            ],
          } as never,
          other.id,
          { actorUserId: ACTOR, systemReason: 'test' },
        ),
      );
      const foreignLineId = foreignEntry.lines.find(
        (line) => line.accountId === otherAccounts[0].id,
      )!.id;

      const statement = await importCsv(CSV_ONE_DEPOSIT, { endingBalance: 10_000 });

      // The old `matchTransactions` loaded the line by id alone and wrote `isReconciled = true`.
      await expect(
        reconciliation.confirmMatch(
          {
            statementId: statement.id,
            bankTransactionIds: [statement.transactions[0].id],
            journalEntryLineIds: [foreignLineId],
          } as never,
          organizationId,
          ACTOR,
        ),
      ).rejects.toThrow();

      const untouched = await dataSource
        .getRepository(JournalEntryLine)
        .findOneByOrFail({ id: foreignLineId });
      expect(untouched.isReconciled).toBe(false);

      await dataSource.getRepository(Organization).delete({ id: other.id });
    });

    it('refuses to clear the same ledger line twice', async () => {
      const a = await postToBank('2026-03-05', 10_000, 'Cobro cliente');
      const statement = await importCsv(
        [
          'Fecha,Concepto,Entrada,Salida',
          '05/03/2026,Deposito uno,10000.00,',
          '06/03/2026,Deposito dos,10000.00,',
        ].join('\n'),
        { endingBalance: 20_000 },
      );

      const unmatched = statement.transactions.filter(
        (transaction) => transaction.status === TransactionStatus.UNMATCHED,
      );
      // One was auto-matched (a single exact candidate); the other has nothing left to take.
      expect(unmatched).toHaveLength(1);

      await expect(
        reconciliation.confirmMatch(
          {
            statementId: statement.id,
            bankTransactionIds: [unmatched[0].id],
            journalEntryLineIds: [a.lineId],
          } as never,
          organizationId,
          ACTOR,
        ),
      ).rejects.toThrow();
    });

    it('undoes a match and puts both sides back', async () => {
      const a = await postToBank('2026-03-05', 10_000, 'Cobro cliente');
      const statement = await importCsv(CSV_ONE_DEPOSIT, { endingBalance: 10_000 });

      const matches = await reconciliation.listMatches(statement.id, organizationId);
      expect(matches).toHaveLength(1);

      await reconciliation.unmatch(matches[0].id, organizationId);

      const line = await dataSource
        .getRepository(JournalEntryLine)
        .findOneByOrFail({ id: a.lineId });
      expect(line.isReconciled).toBe(false);
      expect(line.reconciledAt).toBeNull();

      const transaction = await dataSource
        .getRepository(BankTransaction)
        .findOneByOrFail({ statementId: statement.id });
      expect(transaction.status).toBe(TransactionStatus.UNMATCHED);
      expect(transaction.matchId).toBeNull();
    });
  });

  // ── the proof ──────────────────────────────────────────────────────────────

  describe('the balance proof', () => {
    it('reports a deposit in transit as an outstanding item and refuses to close', async () => {
      // Recorded in the books on the 30th; the bank only shows it in April.
      await postToBank('2026-03-05', 10_000, 'Cobro cliente');
      await postToBank('2026-03-30', 2_500, 'Cobro en tránsito');

      const statement = await importCsv(CSV_ONE_DEPOSIT, { endingBalance: 10_000 });

      const summary = await reconciliation.summary(statement.id, organizationId);
      expect(summary.bookBalance).toBe(12_500);
      expect(summary.statementEndingBalance).toBe(10_000);
      expect(summary.outstandingLedgerAmount).toBe(2_500);
      expect(summary.unrecordedStatementAmount).toBe(0);
      expect(summary.adjustedBankBalance).toBe(12_500);
      expect(summary.adjustedBookBalance).toBe(12_500);
      expect(summary.difference).toBe(0);
      expect(summary.isReconciled).toBe(true);
      expect(summary.statementIsInternallyConsistent).toBe(true);

      const closed = await reconciliation.closeStatement(
        statement.id,
        organizationId,
        ACTOR,
      );
      expect(closed.status).toBe(StatementStatus.RECONCILED);
      expect(closed.reconciledByUserId).toBe(ACTOR);
    });

    it('refuses to close while a statement line is neither matched nor set aside', async () => {
      const statement = await importCsv(CSV_ONE_DEPOSIT, { endingBalance: 10_000 });

      const summary = await reconciliation.summary(statement.id, organizationId);
      expect(summary.unrecordedStatementCount).toBe(1);

      await expect(
        reconciliation.closeStatement(statement.id, organizationId, ACTOR),
      ).rejects.toThrow();
    });

    it("refuses to close a statement that does not add up against its own balances", async () => {
      await postToBank('2026-03-05', 10_000, 'Cobro cliente');
      // The bank says it closed at 9,000 after a 10,000 deposit from zero. It cannot have.
      const statement = await importCsv(CSV_ONE_DEPOSIT, { endingBalance: 9_000 });

      const summary = await reconciliation.summary(statement.id, organizationId);
      expect(summary.statementIsInternallyConsistent).toBe(false);
      expect(summary.statementInternalDifference).toBe(1_000);

      await expect(
        reconciliation.closeStatement(statement.id, organizationId, ACTOR),
      ).rejects.toThrow();
    });

    it('will not match against a closed statement, and reopening restores it', async () => {
      await postToBank('2026-03-05', 10_000, 'Cobro cliente');
      const statement = await importCsv(CSV_ONE_DEPOSIT, { endingBalance: 10_000 });
      await reconciliation.closeStatement(statement.id, organizationId, ACTOR);

      const matches = await reconciliation.listMatches(statement.id, organizationId);
      await expect(reconciliation.unmatch(matches[0].id, organizationId)).rejects.toThrow();

      const reopened = await reconciliation.reopenStatement(statement.id, organizationId);
      expect(reopened.status).toBe(StatementStatus.IMPORTED);
      expect(reopened.reconciledAt).toBeNull();

      await reconciliation.unmatch(matches[0].id, organizationId);
    });

    it('lets the tenant be deleted once it has an accounting history', async () => {
      await postToBank('2026-03-05', 10_000, 'Cobro cliente');
      const statement = await importCsv(CSV_ONE_DEPOSIT, { endingBalance: 10_000 });
      await reconciliation.closeStatement(statement.id, organizationId, ACTOR);

      // `DELETE FROM organizations` used to fail outright on any tenant that had ever posted an
      // entry: the organization → accounts edge cascaded, accounts → journal_entry_lines did not,
      // and Postgres was blocked by the lines of the accounts it had just removed. Offboarding a
      // customer, or honouring a deletion request, ended in a foreign-key error.
      await expect(
        dataSource.getRepository(Organization).delete({ id: organizationId }),
      ).resolves.toMatchObject({ affected: 1 });

      const orphans = await dataSource.query(
        'SELECT count(*)::int AS count FROM "bank_statements" WHERE "organization_id" = $1',
        [organizationId],
      );
      expect(orphans[0].count).toBe(0);
    });

    it('counts an excluded line out of the proof, with its reason recorded', async () => {
      const statement = await importCsv(
        [
          'Fecha,Concepto,Entrada,Salida',
          '05/03/2026,Cargo duplicado del banco,,500.00',
        ].join('\n'),
        { endingBalance: 0 },
      );

      await reconciliation.excludeTransaction(
        statement.transactions[0].id,
        { reason: 'Cargo duplicado que el banco revirtió en abril' } as never,
        organizationId,
      );

      const summary = await reconciliation.summary(statement.id, organizationId);
      expect(summary.unrecordedStatementCount).toBe(0);
      expect(summary.statementIsInternallyConsistent).toBe(true);
      expect(summary.difference).toBe(0);
    });
  });
});
