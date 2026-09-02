import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { addDays, subDays } from 'date-fns';

import { BankStatement, StatementStatus } from './entities/bank-statement.entity';
import { BankTransaction, TransactionStatus } from './entities/bank-transaction.entity';
import {
  ReconciliationMatch,
  MatchOrigin,
} from './entities/reconciliation-match.entity';
import { ReconciliationMatchLine } from './entities/reconciliation-match-line.entity';
import {
  ReconciliationRule,
  RuleAction,
  RuleConditionField,
  RuleConditionOperator,
  RuleDirection,
} from './entities/reconciliation-rule.entity';
import { CsvParserService, CsvParseError } from './parsers/csv-parser.service';
import { UploadStatementDto } from './dto/upload-statement.dto';
import { ConfirmMatchDto } from './dto/confirm-match.dto';
import { ExcludeTransactionDto } from './dto/exclude-transaction.dto';
import {
  CreateReconciliationRuleDto,
  UpdateReconciliationRuleDto,
} from './dto/reconciliation-rule.dto';

import { BankAccount } from '../treasury/entities/bank-account.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { JournalEntry, JournalEntryStatus } from '../journal-entries/entities/journal-entry.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { AccountBalancesService, toIsoDate } from '../chart-of-accounts/account-balances.service';
import { roundAmount, sumAmounts, toCents } from '../common/money';
import { FastifyFile } from '../common/interfaces/fastify-file.interface';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';

/** A ledger line offered as a counterpart, with why it was offered. */
export interface MatchCandidate {
  journalEntryLineId: string;
  journalEntryId: string;
  entryNumber: string | null;
  date: string;
  description: string | null;
  /** Positive into the account, negative out of it. */
  amount: number;
  /** 0-100. Amount and proximity in time, plus any overlap in wording. */
  score: number;
}

/** Several ledger lines that together explain one statement line. */
export interface MatchCandidateGroup {
  journalEntryLineIds: string[];
  amount: number;
  score: number;
}

export interface TransactionSuggestion {
  bankTransactionId: string;
  date: string;
  description: string;
  amount: number;
  candidates: MatchCandidate[];
  /**
   * Combinations that add up to the statement line when no single ledger line does — the deposit
   * slip covering several cheques, which one-to-one matching could never express.
   */
  candidateGroups: MatchCandidateGroup[];
  /** A rule fired and the transaction has no ledger counterpart to match. */
  suggestedRuleId: string | null;
}

/**
 * The bank reconciliation proof.
 *
 * Two adjusted balances that must meet. Everything unmatched on one side is an item the other side
 * has not seen yet, which is exactly what a reconciliation is for.
 */
export interface ReconciliationSummary {
  statementId: string;
  bankAccountId: string;
  startDate: string;
  endDate: string;
  status: StatementStatus;

  /** What the statement says the account held at `endDate`. */
  statementEndingBalance: number;
  /** What the books say, from posted entries only, on the control account. */
  bookBalance: number;

  /** In the books, not yet on the statement: deposits in transit, uncashed cheques. */
  outstandingLedgerAmount: number;
  outstandingLedgerCount: number;
  /** On the statement, not yet in the books: charges, interest, direct debits. */
  unrecordedStatementAmount: number;
  unrecordedStatementCount: number;

  adjustedBankBalance: number;
  adjustedBookBalance: number;
  /** Zero, or the statement cannot be closed. */
  difference: number;
  isReconciled: boolean;

  /** The statement's own arithmetic: opening + movements should be its closing balance. */
  statementIsInternallyConsistent: boolean;
  statementInternalDifference: number;
}

const CANDIDATE_WINDOW_DAYS = 45;
/**
 * Cap on the subset search for "one deposit, several receipts".
 *
 * A deposit slip covering several cheques is one statement line against several ledger lines, and
 * no single-line candidate will ever explain it. Searching every subset is exponential, so the
 * search is bounded to the same-day lines whose amount could contribute, at most this many of them.
 */
const SUBSET_SEARCH_LIMIT = 8;
const SUBSET_MAX_SUGGESTIONS = 3;

/**
 * Bank reconciliation.
 *
 * ## What this module did
 *
 * `autoReconcileStatement` matched a statement line against a rule and then **posted a brand-new
 * journal entry** for it — debiting the bank account and crediting the rule's target — before
 * marking the statement line reconciled against the line it had just created. Every customer
 * receipt and supplier payment that appeared on a statement would have been recorded twice: once
 * when it happened, again when the bank confirmed it. Cash, revenue and expense all overstated,
 * with a clean-looking reconciliation on top. It never fired only because no endpoint could create
 * a rule, and because the loop crashed on `transaction.date.toISOString()` — `date` is a `date`
 * column, which TypeORM hands back as a string — inside a `catch` that logged and returned.
 *
 * Reconciliation does not create accounting. It **finds** the ledger line a statement line already
 * corresponds to and clears both. The one exception is a movement the bank itself originated and
 * nobody recorded — a maintenance charge, interest credited — and that is a rule action a tenant
 * has to choose, applied only when no candidate ledger line exists.
 *
 * The rest of what was missing: matching was one-to-one when the everyday cases are not; the
 * statement's opening and closing balances were stored and never read, so nothing could say whether
 * the account reconciled; `matchTransactions` loaded a `JournalEntryLine` by id with no tenant
 * scoping and set `isReconciled` on it, which let any tenant write to any other tenant's ledger;
 * and the route that would have reached it was never registered on the controller.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectRepository(BankStatement)
    private readonly statements: Repository<BankStatement>,
    @InjectRepository(BankTransaction)
    private readonly transactions: Repository<BankTransaction>,
    @InjectRepository(ReconciliationRule)
    private readonly rules: Repository<ReconciliationRule>,
    private readonly csvParser: CsvParserService,
    private readonly journalEntries: JournalEntriesService,
    private readonly balances: AccountBalancesService,
    private readonly dataSource: DataSource,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Import
  // ───────────────────────────────────────────────────────────────────────────

  async importStatement(
    file: FastifyFile,
    dto: UploadStatementDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<BankStatement> {
    const bankAccount = await this.dataSource.manager.findOneBy(BankAccount, {
      id: dto.bankAccountId,
      organizationId,
    });
    if (!bankAccount) {
      throw new BadRequestError('RECONCILIATION.CUENTA_BANCARIA_ESPECIFICADA_NO_ES_VALIDA');
    }
    if (dto.startDate > dto.endDate) {
      throw new BadRequestError('RECONCILIATION.RANGO_FECHAS_INVALIDO');
    }

    const bytes = file.buffer ?? (file.path ? await readFile(file.path) : undefined);
    if (!bytes || bytes.length === 0) {
      throw new BadRequestError('RECONCILIATION.ARCHIVO_SUBIDO_ESTA_VACIO_NO_PUDO_LEER');
    }
    const fileHash = createHash('sha256').update(bytes).digest('hex');

    // The same file twice used to load every transaction a second time, and the duplicates were
    // matchable against ledger lines the first upload had already cleared.
    const duplicate = await this.statements.findOne({
      where: { organizationId, bankAccountId: bankAccount.id, fileHash },
    });
    if (duplicate && duplicate.status !== StatementStatus.FAILED) {
      throw new BadRequestError('RECONCILIATION.ESTADO_CUENTA_YA_IMPORTADO', {
        statementId: duplicate.id,
        fileName: duplicate.fileName,
      });
    }

    const statement = await this.statements.save(
      this.statements.create({
        organizationId,
        bankAccountId: bankAccount.id,
        fileName: file.originalname,
        fileHash,
        startDate: dto.startDate,
        endDate: dto.endDate,
        startingBalance: dto.startingBalance,
        endingBalance: dto.endingBalance,
        status: StatementStatus.IMPORTING,
        createdByUserId: actorUserId,
      }),
    );

    try {
      const parsed = await this.csvParser.parse(bytes, {
        date: dto.dateColumn,
        description: dto.descriptionColumn,
        reference: dto.referenceColumn,
        debit: dto.debitColumn,
        credit: dto.creditColumn,
        amount: dto.amountColumn,
        dateFormat: dto.dateFormat,
        decimalSeparator: dto.decimalSeparator ?? '.',
        positiveAmountIsMoneyIn: dto.positiveAmountIsMoneyIn ?? true,
      });

      const outsideRange = parsed.filter(
        (row) => row.date < dto.startDate || row.date > dto.endDate,
      );
      if (outsideRange.length > 0) {
        throw new CsvParseError('INVALID_DATE', {
          reason: 'OUTSIDE_STATEMENT_RANGE',
          rows: outsideRange.slice(0, 5).map((row) => ({ row: row.sourceRow, date: row.date })),
        });
      }

      await this.transactions.save(
        parsed.map((row) =>
          this.transactions.create({
            statementId: statement.id,
            date: row.date,
            description: row.description,
            reference: row.reference,
            debit: row.debit,
            credit: row.credit,
            sourceRow: row.sourceRow,
            status: TransactionStatus.UNMATCHED,
          }),
        ),
      );

      statement.status = StatementStatus.IMPORTED;
      statement.importError = null;
      await this.statements.save(statement);
    } catch (error) {
      // Recorded on the statement, not only in the log: the uploader has to be able to see which
      // row of their file the import stopped on.
      statement.status = StatementStatus.FAILED;
      statement.importError =
        error instanceof CsvParseError
          ? `${error.reason}: ${JSON.stringify(error.detail)}`
          : (error as Error).message;
      await this.statements.save(statement);
      this.logger.warn(
        `Importación del estado de cuenta ${statement.id} fallida: ${statement.importError}`,
      );
      throw new BadRequestError('RECONCILIATION.FORMATO_ARCHIVO_CSV_NO_ES_VALIDO_ESTA', {
        detail: statement.importError,
      });
    }

    // Synchronous, and inside the request: the old code kicked auto-reconciliation off with a
    // detached promise and a `.catch(log)`, so the caller saw "completed" whatever happened.
    await this.applyRules(statement.id, organizationId, actorUserId);

    return this.findStatement(statement.id, organizationId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reading
  // ───────────────────────────────────────────────────────────────────────────

  listStatements(organizationId: string, bankAccountId?: string): Promise<BankStatement[]> {
    return this.statements.find({
      where: bankAccountId ? { organizationId, bankAccountId } : { organizationId },
      order: { endDate: 'DESC', createdAt: 'DESC' },
    });
  }

  async findStatement(id: string, organizationId: string): Promise<BankStatement> {
    const statement = await this.statements.findOne({
      where: { id, organizationId },
      relations: ['transactions', 'bankAccount'],
    });
    if (!statement) throw new NotFoundError('RECONCILIATION.ESTADO_CUENTA_NO_ENCONTRADO');
    statement.transactions.sort((a, b) =>
      a.date === b.date ? (a.sourceRow ?? 0) - (b.sourceRow ?? 0) : a.date < b.date ? -1 : 1,
    );
    return statement;
  }

  /**
   * Statement lines with the ledger lines that could be their counterpart.
   *
   * Candidates come from **posted** entries on the bank account's control account. The old view
   * placed no status filter at all, so a draft entry — one that is not in the ledger and may never
   * be — could be reconciled against a real bank movement.
   */
  async suggestMatches(
    statementId: string,
    organizationId: string,
  ): Promise<TransactionSuggestion[]> {
    const statement = await this.findStatement(statementId, organizationId);
    const bankAccount = await this.dataSource.manager.findOneByOrFail(BankAccount, {
      id: statement.bankAccountId,
    });

    const unmatched = statement.transactions.filter(
      (transaction) => transaction.status === TransactionStatus.UNMATCHED,
    );
    if (unmatched.length === 0) return [];

    const candidates = await this.availableLedgerLines(
      this.dataSource.manager,
      organizationId,
      bankAccount.glAccountId,
      statement.startDate,
      statement.endDate,
    );
    const rules = await this.activeRules(this.dataSource.manager, organizationId);

    return unmatched.map((transaction) => {
      const amount = signedAmount(transaction);
      const scored = candidates
        .map((line) => ({
          journalEntryLineId: line.id,
          journalEntryId: line.journalEntryId,
          entryNumber: line.entryNumber,
          date: line.date,
          description: line.description,
          amount: line.amount,
          score: scoreCandidate(transaction, amount, line),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      const groups =
        scored.length === 0 ? findSubsetsSummingTo(candidates, amount, transaction.date) : [];

      const rule = rules.find((candidate) => this.ruleMatches(candidate, transaction));

      return {
        bankTransactionId: transaction.id,
        date: transaction.date,
        description: transaction.description,
        amount,
        candidates: scored,
        candidateGroups: groups,
        suggestedRuleId:
          scored.length === 0 && groups.length === 0 && rule ? rule.id : null,
      };
    });
  }

  /**
   * The proof.
   *
   * `starting_balance` and `ending_balance` were columns nothing read. Without them a reconciliation
   * is a list of matches with no statement to answer to: it can be entirely "done" while the
   * account is out by a movement neither side ever saw.
   */
  async summary(statementId: string, organizationId: string): Promise<ReconciliationSummary> {
    const statement = await this.findStatement(statementId, organizationId);
    const bankAccount = await this.dataSource.manager.findOneByOrFail(BankAccount, {
      id: statement.bankAccountId,
    });
    const ledger = await this.dataSource.manager.findOneBy(Ledger, {
      organizationId,
      isDefault: true,
    });
    if (!ledger) {
      throw new BadRequestError('RECONCILIATION.NO_HAY_LIBRO_CONTABLE_POR_DEFECTO');
    }

    const bookBalance = await this.balances.balanceOf(bankAccount.glAccountId, {
      organizationId,
      ledgerId: ledger.id,
      asOf: statement.endDate,
    });

    // In the books but not on the statement, up to the statement's closing date.
    const outstanding = await this.availableLedgerLines(
      this.dataSource.manager,
      organizationId,
      bankAccount.glAccountId,
      statement.startDate,
      statement.endDate,
      { onlyUpToEndDate: true },
    );
    const outstandingLedgerAmount = sumAmounts(outstanding.map((line) => line.amount));

    // On the statement but not in the books.
    const unrecorded = statement.transactions.filter(
      (transaction) => transaction.status === TransactionStatus.UNMATCHED,
    );
    const unrecordedStatementAmount = sumAmounts(unrecorded.map(signedAmount));

    const adjustedBankBalance = roundAmount(statement.endingBalance + outstandingLedgerAmount);
    const adjustedBookBalance = roundAmount(bookBalance + unrecordedStatementAmount);
    const difference = roundAmount(adjustedBookBalance - adjustedBankBalance);

    const movements = sumAmounts(
      statement.transactions
        .filter((transaction) => transaction.status !== TransactionStatus.EXCLUDED)
        .map(signedAmount),
    );
    const statementInternalDifference = roundAmount(
      statement.startingBalance + movements - statement.endingBalance,
    );

    return {
      statementId: statement.id,
      bankAccountId: statement.bankAccountId,
      startDate: statement.startDate,
      endDate: statement.endDate,
      status: statement.status,
      statementEndingBalance: statement.endingBalance,
      bookBalance,
      outstandingLedgerAmount,
      outstandingLedgerCount: outstanding.length,
      unrecordedStatementAmount,
      unrecordedStatementCount: unrecorded.length,
      adjustedBankBalance,
      adjustedBookBalance,
      difference,
      isReconciled: toCents(difference) === 0,
      statementIsInternallyConsistent: toCents(statementInternalDifference) === 0,
      statementInternalDifference,
    };
  }

  listMatches(statementId: string, organizationId: string): Promise<ReconciliationMatch[]> {
    return this.dataSource.manager.find(ReconciliationMatch, {
      where: { statementId, organizationId },
      relations: ['transactions', 'lines'],
      order: { createdAt: 'ASC' },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Matching
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Clear a group of statement lines against a group of ledger lines.
   *
   * Every id is re-read under the tenant before anything is written. The old implementation loaded
   * the ledger line by id alone and set `isReconciled` on it, so a caller from one tenant could
   * mark another tenant's ledger line reconciled by guessing — or enumerating — a uuid.
   */
  async confirmMatch(
    dto: ConfirmMatchDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<ReconciliationMatch> {
    return this.dataSource.transaction(async (manager) => {
      const statement = await manager.findOne(BankStatement, {
        where: { id: dto.statementId, organizationId },
      });
      if (!statement) throw new NotFoundError('RECONCILIATION.ESTADO_CUENTA_NO_ENCONTRADO');
      if (statement.status === StatementStatus.RECONCILED) {
        throw new BadRequestError('RECONCILIATION.ESTADO_CUENTA_CERRADO');
      }

      return this.writeMatch(manager, {
        statement,
        organizationId,
        bankTransactionIds: dto.bankTransactionIds,
        journalEntryLineIds: dto.journalEntryLineIds,
        origin: MatchOrigin.MANUAL,
        ruleId: null,
        actorUserId,
        notes: dto.notes ?? null,
      });
    });
  }

  /** Undo a match. Both sides go back to being outstanding items. */
  async unmatch(matchId: string, organizationId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const match = await manager.findOne(ReconciliationMatch, {
        where: { id: matchId, organizationId },
        relations: ['lines', 'statement'],
      });
      if (!match) throw new NotFoundError('RECONCILIATION.CONCILIACION_NO_ENCONTRADA');
      if (match.statement.status === StatementStatus.RECONCILED) {
        throw new BadRequestError('RECONCILIATION.ESTADO_CUENTA_CERRADO');
      }

      const lineIds = match.lines.map((line) => line.journalEntryLineId);
      if (lineIds.length > 0) {
        await manager.update(
          JournalEntryLine,
          { id: In(lineIds) },
          { isReconciled: false, reconciledAt: null },
        );
      }
      await manager.update(
        BankTransaction,
        { matchId: match.id },
        { status: TransactionStatus.UNMATCHED, matchId: null },
      );
      await manager.delete(ReconciliationMatchLine, { matchId: match.id });
      await manager.delete(ReconciliationMatch, { id: match.id });
    });
  }

  /**
   * Set a statement line aside.
   *
   * A reason is required: a closed statement whose proof depends on a line somebody dropped has to
   * say who dropped it and why.
   */
  async excludeTransaction(
    transactionId: string,
    dto: ExcludeTransactionDto,
    organizationId: string,
  ): Promise<BankTransaction> {
    return this.dataSource.transaction(async (manager) => {
      const transaction = await manager.findOne(BankTransaction, {
        where: { id: transactionId, statement: { organizationId } },
        relations: ['statement'],
      });
      if (!transaction) {
        throw new NotFoundError('RECONCILIATION.TRANSACCION_BANCARIA_NO_ENCONTRADA');
      }
      if (transaction.statement.status === StatementStatus.RECONCILED) {
        throw new BadRequestError('RECONCILIATION.ESTADO_CUENTA_CERRADO');
      }
      if (transaction.status === TransactionStatus.MATCHED) {
        throw new BadRequestError('RECONCILIATION.TRANSACCION_YA_CONCILIADA');
      }

      transaction.status = TransactionStatus.EXCLUDED;
      transaction.exclusionReason = dto.reason;
      return manager.save(transaction);
    });
  }

  /**
   * Close the statement.
   *
   * Only from a difference of zero. This is the step the module never had: matches could be
   * recorded indefinitely and nothing ever asserted that the account agreed with the bank.
   */
  async closeStatement(
    statementId: string,
    organizationId: string,
    actorUserId: string,
  ): Promise<BankStatement> {
    const summary = await this.summary(statementId, organizationId);
    if (summary.status === StatementStatus.RECONCILED) {
      throw new BadRequestError('RECONCILIATION.ESTADO_CUENTA_CERRADO');
    }
    if (summary.status !== StatementStatus.IMPORTED) {
      throw new BadRequestError('RECONCILIATION.ESTADO_CUENTA_NO_IMPORTADO');
    }
    if (!summary.statementIsInternallyConsistent) {
      throw new BadRequestError('RECONCILIATION.ESTADO_CUENTA_NO_CUADRA_CONSIGO_MISMO', {
        difference: summary.statementInternalDifference,
      });
    }
    if (summary.unrecordedStatementCount > 0) {
      throw new BadRequestError('RECONCILIATION.QUEDAN_TRANSACCIONES_SIN_CONCILIAR', {
        count: summary.unrecordedStatementCount,
      });
    }
    if (!summary.isReconciled) {
      throw new BadRequestError('RECONCILIATION.CONCILIACION_NO_CUADRA', {
        difference: summary.difference,
      });
    }

    const statement = await this.statements.findOneByOrFail({
      id: statementId,
      organizationId,
    });
    statement.status = StatementStatus.RECONCILED;
    statement.reconciledAt = new Date();
    statement.reconciledByUserId = actorUserId;
    return this.statements.save(statement);
  }

  async reopenStatement(statementId: string, organizationId: string): Promise<BankStatement> {
    const statement = await this.statements.findOne({
      where: { id: statementId, organizationId },
    });
    if (!statement) throw new NotFoundError('RECONCILIATION.ESTADO_CUENTA_NO_ENCONTRADO');
    if (statement.status !== StatementStatus.RECONCILED) {
      throw new BadRequestError('RECONCILIATION.ESTADO_CUENTA_NO_ESTA_CERRADO');
    }
    statement.status = StatementStatus.IMPORTED;
    statement.reconciledAt = null;
    statement.reconciledByUserId = null;
    return this.statements.save(statement);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rules
  // ───────────────────────────────────────────────────────────────────────────

  listRules(organizationId: string): Promise<ReconciliationRule[]> {
    return this.rules.find({
      where: { organizationId },
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
  }

  async createRule(
    dto: CreateReconciliationRuleDto,
    organizationId: string,
  ): Promise<ReconciliationRule> {
    await this.validateRule(dto, organizationId);
    return this.rules.save(
      this.rules.create({
        organizationId,
        name: dto.name,
        conditionField: dto.conditionField,
        conditionOperator: dto.conditionOperator,
        conditionValue: dto.conditionValue,
        direction: dto.direction ?? RuleDirection.ANY,
        amountMin: dto.amountMin ?? null,
        amountMax: dto.amountMax ?? null,
        action: dto.action ?? RuleAction.MATCH_EXISTING,
        targetAccountId: dto.targetAccountId ?? null,
        priority: dto.priority ?? 100,
        isActive: dto.isActive ?? true,
      }),
    );
  }

  async updateRule(
    id: string,
    dto: UpdateReconciliationRuleDto,
    organizationId: string,
  ): Promise<ReconciliationRule> {
    const rule = await this.rules.findOne({ where: { id, organizationId } });
    if (!rule) throw new NotFoundError('RECONCILIATION.REGLA_NO_ENCONTRADA');

    const merged = { ...rule, ...dto };
    await this.validateRule(merged, organizationId);

    if (dto.name !== undefined) rule.name = dto.name;
    if (dto.conditionField !== undefined) rule.conditionField = dto.conditionField;
    if (dto.conditionOperator !== undefined) rule.conditionOperator = dto.conditionOperator;
    if (dto.conditionValue !== undefined) rule.conditionValue = dto.conditionValue;
    if (dto.direction !== undefined) rule.direction = dto.direction;
    if (dto.amountMin !== undefined) rule.amountMin = dto.amountMin;
    if (dto.amountMax !== undefined) rule.amountMax = dto.amountMax;
    if (dto.action !== undefined) rule.action = dto.action;
    if (dto.targetAccountId !== undefined) rule.targetAccountId = dto.targetAccountId;
    if (dto.priority !== undefined) rule.priority = dto.priority;
    if (dto.isActive !== undefined) rule.isActive = dto.isActive;

    return this.rules.save(rule);
  }

  async deleteRule(id: string, organizationId: string): Promise<void> {
    const result = await this.rules.delete({ id, organizationId });
    if (!result.affected) throw new NotFoundError('RECONCILIATION.REGLA_NO_ENCONTRADA');
  }

  /**
   * Run the tenant's rules over a statement.
   *
   * A `MATCH_EXISTING` rule clears against a ledger line that already exists — never by posting
   * one. A `CREATE_ENTRY` rule posts the entry the books are missing, and **only** when the matcher
   * found no candidate at all: that is what keeps a rule from duplicating a movement the ledger
   * already carries, which is precisely what the previous implementation did on every match.
   */
  async applyRules(
    statementId: string,
    organizationId: string,
    actorUserId: string,
  ): Promise<{ matched: number; created: number }> {
    return this.dataSource.transaction(async (manager) => {
      const statement = await manager.findOne(BankStatement, {
        where: { id: statementId, organizationId },
        relations: ['transactions'],
      });
      if (!statement) throw new NotFoundError('RECONCILIATION.ESTADO_CUENTA_NO_ENCONTRADO');
      if (statement.status === StatementStatus.RECONCILED) {
        throw new BadRequestError('RECONCILIATION.ESTADO_CUENTA_CERRADO');
      }

      const bankAccount = await manager.findOneByOrFail(BankAccount, {
        id: statement.bankAccountId,
      });
      const rules = await this.activeRules(manager, organizationId);

      let matched = 0;
      let created = 0;

      for (const transaction of statement.transactions) {
        if (transaction.status !== TransactionStatus.UNMATCHED) continue;

        const amount = signedAmount(transaction);
        const available = await this.availableLedgerLines(
          manager,
          organizationId,
          bankAccount.glAccountId,
          statement.startDate,
          statement.endDate,
        );

        // A single unambiguous counterpart: same amount, inside the window, one candidate only.
        // Anything less certain is left for a person, which is why `suggestMatches` exists.
        const exact = available.filter((line) => toCents(line.amount) === toCents(amount));
        if (exact.length === 1) {
          await this.writeMatch(manager, {
            statement,
            organizationId,
            bankTransactionIds: [transaction.id],
            journalEntryLineIds: [exact[0].id],
            origin: MatchOrigin.AUTOMATIC,
            ruleId: null,
            actorUserId,
            notes: null,
          });
          matched += 1;
          continue;
        }

        const rule = rules.find((candidate) => this.ruleMatches(candidate, transaction));
        if (!rule) continue;

        if (rule.action === RuleAction.MATCH_EXISTING) {
          const byRule = exact.length === 1 ? exact : [];
          if (byRule.length === 1) {
            await this.writeMatch(manager, {
              statement,
              organizationId,
              bankTransactionIds: [transaction.id],
              journalEntryLineIds: [byRule[0].id],
              origin: MatchOrigin.RULE,
              ruleId: rule.id,
              actorUserId,
              notes: null,
            });
            matched += 1;
          }
          continue;
        }

        // CREATE_ENTRY, and only with nothing to match: the books really are missing this.
        if (available.some((line) => toCents(line.amount) === toCents(amount))) continue;
        if (!rule.targetAccountId) continue;

        const line = await this.postMissingEntry(
          manager,
          statement,
          bankAccount,
          transaction,
          rule,
          organizationId,
          actorUserId,
        );
        await this.writeMatch(manager, {
          statement,
          organizationId,
          bankTransactionIds: [transaction.id],
          journalEntryLineIds: [line.id],
          origin: MatchOrigin.RULE,
          ruleId: rule.id,
          actorUserId,
          notes: null,
        });
        created += 1;
      }

      return { matched, created };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  private async writeMatch(
    manager: EntityManager,
    input: {
      statement: BankStatement;
      organizationId: string;
      bankTransactionIds: string[];
      journalEntryLineIds: string[];
      origin: MatchOrigin;
      ruleId: string | null;
      actorUserId: string;
      notes: string | null;
    },
  ): Promise<ReconciliationMatch> {
    const {
      statement,
      organizationId,
      bankTransactionIds,
      journalEntryLineIds,
      origin,
      ruleId,
      actorUserId,
      notes,
    } = input;

    if (bankTransactionIds.length === 0 || journalEntryLineIds.length === 0) {
      throw new BadRequestError('RECONCILIATION.CONCILIACION_REQUIERE_AMBOS_LADOS');
    }
    if (new Set(bankTransactionIds).size !== bankTransactionIds.length) {
      throw new BadRequestError('RECONCILIATION.TRANSACCION_REPETIDA_EN_CONCILIACION');
    }
    if (new Set(journalEntryLineIds).size !== journalEntryLineIds.length) {
      throw new BadRequestError('RECONCILIATION.LINEA_REPETIDA_EN_CONCILIACION');
    }

    // Statement lines: they must belong to this statement, which belongs to this tenant.
    const transactions = await manager.find(BankTransaction, {
      where: { id: In(bankTransactionIds), statementId: statement.id },
    });
    if (transactions.length !== bankTransactionIds.length) {
      throw new BadRequestError('RECONCILIATION.TRANSACCION_BANCARIA_NO_ENCONTRADA');
    }
    const alreadyUsed = transactions.find(
      (transaction) => transaction.status !== TransactionStatus.UNMATCHED,
    );
    if (alreadyUsed) {
      throw new BadRequestError('RECONCILIATION.TRANSACCION_YA_CONCILIADA', {
        id: alreadyUsed.id,
      });
    }

    const bankAccount = await manager.findOneByOrFail(BankAccount, {
      id: statement.bankAccountId,
    });

    // Ledger lines: scoped by tenant through the entry, restricted to the account this statement
    // belongs to, and to entries that are actually in the ledger.
    const lines = await manager
      .createQueryBuilder(JournalEntryLine, 'line')
      .innerJoin(JournalEntry, 'entry', 'entry.id = line.journal_entry_id')
      .where('line.id IN (:...ids)', { ids: journalEntryLineIds })
      .andWhere('entry.organizationId = :organizationId', { organizationId })
      .andWhere('entry.status = :status', { status: JournalEntryStatus.POSTED })
      .andWhere('line.accountId = :accountId', { accountId: bankAccount.glAccountId })
      .getMany();

    if (lines.length !== journalEntryLineIds.length) {
      throw new BadRequestError('RECONCILIATION.LINEA_CONTABLE_NO_VALIDA_PARA_ESTA_CUENTA');
    }
    const alreadyReconciled = lines.find((line) => line.isReconciled);
    if (alreadyReconciled) {
      throw new BadRequestError('RECONCILIATION.LINEA_CONTABLE_YA_CONCILIADA', {
        id: alreadyReconciled.id,
      });
    }

    const bankSide = sumAmounts(transactions.map(signedAmount));
    const ledgerSide = sumAmounts(lines.map((line) => roundAmount(line.debit - line.credit)));
    if (toCents(bankSide) !== toCents(ledgerSide)) {
      throw new BadRequestError('RECONCILIATION.CONCILIACION_NO_BALANCEA', {
        bank: bankSide,
        ledger: ledgerSide,
      });
    }

    const match = await manager.save(
      manager.create(ReconciliationMatch, {
        organizationId,
        statementId: statement.id,
        amount: bankSide,
        origin,
        ruleId,
        matchedByUserId: actorUserId,
        notes,
      }),
    );

    await manager.save(
      lines.map((line) =>
        manager.create(ReconciliationMatchLine, {
          matchId: match.id,
          journalEntryLineId: line.id,
        }),
      ),
    );

    const reconciledAt = new Date();
    await manager.update(
      JournalEntryLine,
      { id: In(lines.map((line) => line.id)) },
      { isReconciled: true, reconciledAt },
    );
    await manager.update(
      BankTransaction,
      { id: In(transactions.map((transaction) => transaction.id)) },
      { status: TransactionStatus.MATCHED, matchId: match.id },
    );

    return match;
  }

  /** Ledger lines on the account that no match has claimed. */
  private async availableLedgerLines(
    manager: EntityManager,
    organizationId: string,
    glAccountId: string,
    startDate: string,
    endDate: string,
    options: { onlyUpToEndDate?: boolean } = {},
  ): Promise<
    {
      id: string;
      journalEntryId: string;
      entryNumber: string | null;
      date: string;
      description: string | null;
      amount: number;
    }[]
  > {
    const from = options.onlyUpToEndDate
      ? null
      : toIsoDate(subDays(new Date(`${startDate}T00:00:00Z`), CANDIDATE_WINDOW_DAYS));
    const to = options.onlyUpToEndDate
      ? endDate
      : toIsoDate(addDays(new Date(`${endDate}T00:00:00Z`), CANDIDATE_WINDOW_DAYS));

    const query = manager
      .createQueryBuilder(JournalEntryLine, 'line')
      .innerJoin(JournalEntry, 'entry', 'entry.id = line.journal_entry_id')
      .select([
        'line.id AS id',
        'entry.id AS "journalEntryId"',
        'entry.entry_number AS "entryNumber"',
        'entry.date AS date',
        'line.description AS description',
        'line.debit AS debit',
        'line.credit AS credit',
      ])
      .where('entry.organization_id = :organizationId', { organizationId })
      .andWhere('entry.status = :status', { status: JournalEntryStatus.POSTED })
      .andWhere('line.account_id = :glAccountId', { glAccountId })
      .andWhere('line.is_reconciled = false')
      .andWhere('entry.date <= :to', { to })
      .orderBy('entry.date', 'ASC');

    if (from) query.andWhere('entry.date >= :from', { from });

    const rows = await query.getRawMany<{
      id: string;
      journalEntryId: string;
      entryNumber: string | null;
      date: Date | string;
      description: string | null;
      debit: string;
      credit: string;
    }>();

    return rows.map((row) => ({
      id: row.id,
      journalEntryId: row.journalEntryId,
      entryNumber: row.entryNumber,
      date: toIsoDate(row.date),
      description: row.description,
      amount: roundAmount(Number(row.debit) - Number(row.credit)),
    }));
  }

  private activeRules(
    manager: EntityManager,
    organizationId: string,
  ): Promise<ReconciliationRule[]> {
    return manager.find(ReconciliationRule, {
      where: { organizationId, isActive: true },
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
  }

  private ruleMatches(rule: ReconciliationRule, transaction: BankTransaction): boolean {
    const amount = signedAmount(transaction);
    const magnitude = Math.abs(amount);

    if (rule.direction === RuleDirection.MONEY_IN && amount <= 0) return false;
    if (rule.direction === RuleDirection.MONEY_OUT && amount >= 0) return false;
    if (rule.amountMin !== null && magnitude < rule.amountMin) return false;
    if (rule.amountMax !== null && magnitude > rule.amountMax) return false;

    const subject =
      rule.conditionField === RuleConditionField.DESCRIPTION
        ? transaction.description
        : rule.conditionField === RuleConditionField.REFERENCE
          ? (transaction.reference ?? '')
          : magnitude.toFixed(2);

    const haystack = subject.toLocaleLowerCase();
    const needle = rule.conditionValue.toLocaleLowerCase();

    switch (rule.conditionOperator) {
      case RuleConditionOperator.CONTAINS:
        return haystack.includes(needle);
      case RuleConditionOperator.EQUALS:
        return haystack === needle;
      case RuleConditionOperator.STARTS_WITH:
        return haystack.startsWith(needle);
      case RuleConditionOperator.ENDS_WITH:
        return haystack.endsWith(needle);
      default:
        return false;
    }
  }

  private async validateRule(
    rule: {
      action?: RuleAction;
      targetAccountId?: string | null;
      amountMin?: number | null;
      amountMax?: number | null;
    },
    organizationId: string,
  ): Promise<void> {
    const action = rule.action ?? RuleAction.MATCH_EXISTING;
    if (action === RuleAction.CREATE_ENTRY) {
      if (!rule.targetAccountId) {
        throw new BadRequestError('RECONCILIATION.REGLA_CREAR_ASIENTO_REQUIERE_CUENTA');
      }
      const account = await this.dataSource.manager.findOneBy(Account, {
        id: rule.targetAccountId,
        organizationId,
      });
      if (!account) throw new BadRequestError('RECONCILIATION.CUENTA_DESTINO_NO_VALIDA');
      if (!account.isPostable) {
        throw new BadRequestError('RECONCILIATION.CUENTA_DESTINO_NO_ADMITE_MOVIMIENTOS');
      }
    }
    if (
      rule.amountMin !== null &&
      rule.amountMin !== undefined &&
      rule.amountMax !== null &&
      rule.amountMax !== undefined &&
      rule.amountMin > rule.amountMax
    ) {
      throw new BadRequestError('RECONCILIATION.RANGO_MONTOS_INVALIDO');
    }
  }

  /** The entry the books were missing — a bank charge, interest credited, a transaction tax. */
  private async postMissingEntry(
    manager: EntityManager,
    statement: BankStatement,
    bankAccount: BankAccount,
    transaction: BankTransaction,
    rule: ReconciliationRule,
    organizationId: string,
    actorUserId: string,
  ): Promise<JournalEntryLine> {
    const ledger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
    if (!ledger) {
      throw new BadRequestError('RECONCILIATION.NO_HAY_LIBRO_CONTABLE_POR_DEFECTO');
    }
    const journal = await manager.findOneBy(Journal, { organizationId, code: 'CONCIL' });
    if (!journal) {
      throw new BadRequestError('RECONCILIATION.DIARIO_CONCILIACION_CONCIL_NO_ENCONTRADO');
    }

    const entry = await this.journalEntries.createWithManager(
      manager,
      {
        date: transaction.date,
        description: `Conciliación bancaria — ${transaction.description}`,
        journalId: journal.id,
        lines: [
          {
            accountId: bankAccount.glAccountId,
            debit: transaction.debit,
            credit: transaction.credit,
            description: transaction.description,
            valuations: [
              { ledgerId: ledger.id, debit: transaction.debit, credit: transaction.credit },
            ],
          },
          {
            accountId: rule.targetAccountId as string,
            debit: transaction.credit,
            credit: transaction.debit,
            description: `Regla: ${rule.name}`,
            valuations: [
              { ledgerId: ledger.id, debit: transaction.credit, credit: transaction.debit },
            ],
          },
        ],
      } as CreateJournalEntryDto,
      organizationId,
      { actorUserId, systemReason: `bank-reconciliation:${statement.id}` },
    );

    const line = entry.lines.find((candidate) => candidate.accountId === bankAccount.glAccountId);
    if (!line) {
      throw new BadRequestError('RECONCILIATION.ASIENTO_GENERADO_SIN_LINEA_DE_BANCO');
    }
    return line;
  }
}

/**
 * Subsets of ledger lines that add up to one statement line.
 *
 * Bounded twice over: only lines on the same side of the account and within a week of the statement
 * line are considered, and at most `SUBSET_SEARCH_LIMIT` of them, so the enumeration is 2^8 in the
 * worst case rather than 2^n over an account's whole history.
 */
function findSubsetsSummingTo(
  lines: { id: string; date: string; amount: number }[],
  target: number,
  transactionDate: string,
): MatchCandidateGroup[] {
  const targetCents = toCents(target);
  if (targetCents === 0) return [];

  const sameSide = lines
    .filter((line) => {
      const cents = toCents(line.amount);
      if (cents === 0) return false;
      if (Math.sign(cents) !== Math.sign(targetCents)) return false;
      if (Math.abs(cents) > Math.abs(targetCents)) return false;
      const days = Math.abs(
        (Date.parse(`${line.date}T00:00:00Z`) - Date.parse(`${transactionDate}T00:00:00Z`)) /
          86_400_000,
      );
      return days <= 7;
    })
    .sort((a, b) => Math.abs(toCents(b.amount)) - Math.abs(toCents(a.amount)))
    .slice(0, SUBSET_SEARCH_LIMIT);

  const found: MatchCandidateGroup[] = [];
  const total = 1 << sameSide.length;

  for (let mask = 1; mask < total && found.length < SUBSET_MAX_SUGGESTIONS; mask++) {
    // A single line is a plain candidate, not a group; the caller already looked for those.
    if ((mask & (mask - 1)) === 0) continue;

    let sum = 0;
    const ids: string[] = [];
    for (let index = 0; index < sameSide.length; index++) {
      if (mask & (1 << index)) {
        sum += toCents(sameSide[index].amount);
        ids.push(sameSide[index].id);
      }
    }
    if (sum !== targetCents) continue;

    found.push({
      journalEntryLineIds: ids,
      amount: roundAmount(sum / 100),
      // Below any exact single-line match: a person should confirm a grouping.
      score: Math.max(40, 70 - (ids.length - 2) * 10),
    });
  }

  return found;
}

/** Positive into the account, negative out of it. */
function signedAmount(transaction: BankTransaction | { debit: number; credit: number }): number {
  return roundAmount(Number(transaction.debit) - Number(transaction.credit));
}

/**
 * How likely a ledger line is to be this statement line.
 *
 * The amount has to be exact — a bank reconciliation that tolerates a near miss on the figure is
 * not a reconciliation. Everything else is tie-breaking: how close the dates are, and whether the
 * wording overlaps.
 */
function scoreCandidate(
  transaction: BankTransaction,
  amount: number,
  line: { date: string; description: string | null; amount: number },
): number {
  if (toCents(line.amount) !== toCents(amount)) return 0;

  const days = Math.abs(
    (Date.parse(`${line.date}T00:00:00Z`) - Date.parse(`${transaction.date}T00:00:00Z`)) /
      86_400_000,
  );
  let score = days === 0 ? 90 : days <= 3 ? 80 : days <= 10 ? 70 : days <= 30 ? 60 : 50;

  const words = new Set(
    (transaction.description ?? '')
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4),
  );
  const ledgerWords = (line.description ?? '').toLocaleLowerCase();
  if ([...words].some((word) => ledgerWords.includes(word))) score += 10;

  return Math.min(100, score);
}

export { signedAmount };
