import { Injectable } from '@nestjs/common';
import { Between, DataSource, EntityManager, In, LessThan } from 'typeorm';
import { JournalEntry, JournalEntryStatus } from '../entities/journal-entry.entity';
import { JournalEntryLine } from '../entities/journal-entry-line.entity';
import { JournalEntryLineValuation } from '../entities/journal-entry-line-valuation.entity';
import { type IsoDate, toIsoDate } from '../../common/dates';

// ── Row types returned to consumers — no JE entity classes cross the boundary ─────────────────

/**
 * One line of the general ledger as seen by the Libro Mayor.
 *
 * Contains enough for the consumer to assemble a running balance; it intentionally carries no
 * entity references so the caller has no way to issue further queries through the JE repositories.
 */
export interface GeneralLedgerLineRow {
  id: string;
  journalEntryId: string;
  reference: string | null;
  date: IsoDate;
  entryDescription: string;
  journalCode: string | null;
  lineDescription: string | null;
  debit: number;
  credit: number;
}

/** One line of the Libro Diario entry batch fetched for the journal report. */
export interface JournalReportLineRow {
  entryId: string;
  lineId: string;
  accountId: string;
  accountName: Record<string, string> | string;
  description: string | null;
  dimensions: Record<string, string> | null;
  debit: number;
  credit: number;
}

/** Aggregated count by accountId — used by chart-of-accounts to check for movements before allowing changes. */
export interface AccountMovementCount {
  accountId: string;
  count: number;
}

/** Minimal JE line data the reconciliation matching algorithm needs. */
export interface ReconciliationLineRow {
  id: string;
  journalEntryId: string;
  accountId: string;
  currencyCode: string | null;
  foreignCurrencyDebit: number | null;
  foreignCurrencyCredit: number | null;
  isReconciled: boolean;
}

/** One ledger valuation record. */
export interface ValuationRow {
  journalEntryLineId: string;
  ledgerId: string;
  debit: number;
  credit: number;
}

/**
 * Read-only queries against journal entry lines that other bounded contexts need.
 *
 * ## Why this exists
 *
 * `AccountingModule` (`LedgersService`, `ClosingChecklistService`), `ChartOfAccountsModule`, and
 * `ReconciliationModule` all needed to query `JournalEntryLine` and `JournalEntry` rows directly —
 * via `dataSource.manager.getRepository(JournalEntryLine)` — breaking the module boundary
 * completely. This service is the single, explicit surface those modules use to read JE data.
 *
 * ## What it does NOT do
 *
 * It does not expose search, approval flows, attachment management, or any write path other than
 * the reconciliation-specific flag methods below. Callers that need to post entries use
 * `AccountingPostingPort`.
 */
@Injectable()
export class JournalQueryService {
  constructor(private readonly dataSource: DataSource) {}

  // ── General Ledger (used by LedgersService) ──────────────────────────────────────────────────

  /**
   * The raw journal entry lines for one account in a date range.
   *
   * Filters to posted entries only unless `includeUnposted` is set. Returns the rows for the
   * requested page plus the total line count for paging metadata.
   */
  async getGeneralLedgerLines(params: {
    organizationId: string;
    accountId: string;
    ledgerId: string;
    from: IsoDate;
    to: IsoDate;
    includeUnposted?: boolean;
    page: number;
    pageSize: number;
  }): Promise<{ rows: GeneralLedgerLineRow[]; totalLines: number }> {
    const { organizationId, accountId, ledgerId, from, to, includeUnposted, page, pageSize } = params;

    const base = this.dataSource.manager
      .getRepository(JournalEntryLine)
      .createQueryBuilder('line')
      .innerJoin('line.journalEntry', 'entry')
      .innerJoin('entry.journal', 'journal')
      .innerJoin('line.valuations', 'valuation')
      .where('entry.organizationId = :organizationId', { organizationId })
      .andWhere('line.accountId = :accountId', { accountId })
      .andWhere('valuation.ledgerId = :ledgerId', { ledgerId })
      .andWhere('entry.date BETWEEN :from AND :to', { from, to });

    if (!includeUnposted) {
      base.andWhere('entry.status = :posted', { posted: JournalEntryStatus.POSTED });
    }

    const totalLines = await base.clone().getCount();

    const rawRows = await base
      .clone()
      .select([
        'line.id AS id',
        'entry.id AS "journalEntryId"',
        'entry.entry_number AS reference',
        'entry.date AS date',
        'entry.description AS "entryDescription"',
        'journal.code AS "journalCode"',
        'line.description AS "lineDescription"',
        'valuation.debit AS debit',
        'valuation.credit AS credit',
      ])
      .orderBy('entry.date', 'ASC')
      .addOrderBy('entry.entry_number', 'ASC')
      .addOrderBy('line.id', 'ASC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getRawMany<{
        id: string;
        journalEntryId: string;
        reference: string | null;
        date: Date | string;
        entryDescription: string;
        journalCode: string | null;
        lineDescription: string | null;
        debit: string;
        credit: string;
      }>();

    const rows: GeneralLedgerLineRow[] = rawRows.map((row) => ({
      id: row.id,
      journalEntryId: row.journalEntryId,
      reference: row.reference ?? null,
      date: toIsoDate(row.date),
      entryDescription: row.entryDescription,
      journalCode: row.journalCode ?? null,
      lineDescription: row.lineDescription ?? null,
      debit: Number(row.debit),
      credit: Number(row.credit),
    }));

    return { rows, totalLines };
  }

  /**
   * Net signed movement (debit − credit) on the pages that came before this one.
   *
   * Required so a paged running balance stays continuous across page boundaries.
   */
  async getMovementBeforeCurrentPage(params: {
    organizationId: string;
    accountId: string;
    ledgerId: string;
    from: IsoDate;
    to: IsoDate;
    includeUnposted?: boolean;
    page: number;
    pageSize: number;
  }): Promise<number> {
    const { organizationId, accountId, ledgerId, from, to, includeUnposted, page, pageSize } = params;

    const base = this.dataSource.manager
      .getRepository(JournalEntryLine)
      .createQueryBuilder('line')
      .innerJoin('line.journalEntry', 'entry')
      .innerJoin('entry.journal', 'journal')
      .innerJoin('line.valuations', 'valuation')
      .where('entry.organizationId = :organizationId', { organizationId })
      .andWhere('line.accountId = :accountId', { accountId })
      .andWhere('valuation.ledgerId = :ledgerId', { ledgerId })
      .andWhere('entry.date BETWEEN :from AND :to', { from, to });

    if (!includeUnposted) {
      base.andWhere('entry.status = :posted', { posted: JournalEntryStatus.POSTED });
    }

    const inner = base
      .clone()
      .select(['valuation.debit AS debit', 'valuation.credit AS credit'])
      .orderBy('entry.date', 'ASC')
      .addOrderBy('entry.entry_number', 'ASC')
      .addOrderBy('line.id', 'ASC')
      .limit((page - 1) * pageSize);

    const [sql, parameters] = inner.getQueryAndParameters();
    const rows = await this.dataSource.manager.query<{ movement: string }[]>(
      `SELECT COALESCE(SUM(m.debit - m.credit), 0) AS movement FROM (${sql}) m`,
      parameters,
    );
    return Number(rows[0]?.movement ?? 0);
  }

  // ── Journal Report (Libro Diario, used by LedgersService) ────────────────────────────────────

  /**
   * Entries for the journal report, paged by entry. A second query fetches all lines for the
   * entries on the current page in a single round trip.
   */
  async getJournalReportEntries(params: {
    organizationId: string;
    ledgerId: string;
    from: IsoDate;
    to: IsoDate;
    includeUnposted?: boolean;
    journalIds?: string[];
    page: number;
    pageSize: number;
  }): Promise<{
    entries: JournalEntry[];
    lines: JournalReportLineRow[];
    totalEntries: number;
  }> {
    const { organizationId, ledgerId, from, to, includeUnposted, journalIds, page, pageSize } = params;

    const entryQuery = this.dataSource.manager
      .getRepository(JournalEntry)
      .createQueryBuilder('entry')
      .innerJoinAndSelect('entry.journal', 'journal')
      .where('entry.organizationId = :organizationId', { organizationId })
      .andWhere('entry.date BETWEEN :from AND :to', { from, to });

    if (!includeUnposted) {
      entryQuery.andWhere('entry.status = :posted', { posted: JournalEntryStatus.POSTED });
    }
    if (journalIds && journalIds.length > 0) {
      entryQuery.andWhere('entry.journalId IN (:...journalIds)', { journalIds });
    }

    const totalEntries = await entryQuery.clone().getCount();

    const entries = await entryQuery
      .orderBy('entry.date', 'ASC')
      .addOrderBy('entry.entryNumber', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    if (entries.length === 0) {
      return { entries: [], lines: [], totalEntries };
    }

    const rawLines = await this.dataSource.manager
      .getRepository(JournalEntryLine)
      .createQueryBuilder('line')
      .innerJoin('line.journalEntry', 'entry')
      .innerJoin('line.account', 'account')
      .innerJoin('line.valuations', 'valuation')
      .where('entry.id IN (:...entryIds)', { entryIds: entries.map((e) => e.id) })
      .andWhere('valuation.ledgerId = :ledgerId', { ledgerId })
      .select([
        'entry.id AS "entryId"',
        'line.id AS "lineId"',
        'account.id AS "accountId"',
        'account.name AS "accountName"',
        'line.description AS description',
        'line.dimensions AS dimensions',
        'valuation.debit AS debit',
        'valuation.credit AS credit',
      ])
      .orderBy('line.id', 'ASC')
      .getRawMany<{
        entryId: string;
        lineId: string;
        accountId: string;
        accountName: Record<string, string> | string;
        description: string | null;
        dimensions: Record<string, string> | null;
        debit: string;
        credit: string;
      }>();

    const lines: JournalReportLineRow[] = rawLines.map((row) => ({
      entryId: row.entryId,
      lineId: row.lineId,
      accountId: row.accountId,
      accountName: row.accountName,
      description: row.description,
      dimensions: row.dimensions,
      debit: Number(row.debit),
      credit: Number(row.credit),
    }));

    return { entries, lines, totalEntries };
  }

  // ── Chart-of-accounts guards ──────────────────────────────────────────────────────────────────

  /**
   * Whether an account has any journal entry lines recorded against it.
   *
   * Used by ChartOfAccountsService before allowing an account to be deactivated or its hierarchy
   * changed — an account with movements cannot be re-parented because that would rewrite history.
   */
  async hasMovementsForAccount(
    accountId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repo = (manager ?? this.dataSource.manager).getRepository(JournalEntryLine);
    const count = await repo.count({ where: { accountId } });
    return count > 0;
  }

  /**
   * Movement counts grouped by account ID.
   *
   * Used when deactivating multiple accounts at once: tells the caller which ones have
   * transactions (and therefore cannot be deactivated) vs. which can proceed.
   */
  async countMovementsByAccountIds(accountIds: string[]): Promise<AccountMovementCount[]> {
    if (accountIds.length === 0) return [];
    const rows = await this.dataSource.manager
      .getRepository(JournalEntryLine)
      .createQueryBuilder('line')
      .select('line.accountId', 'accountId')
      .addSelect('COUNT(line.id)', 'count')
      .where('line.accountId IN (:...accountIds)', { accountIds })
      .groupBy('line.accountId')
      .getRawMany<{ accountId: string; count: string }>();

    return rows.map((row) => ({ accountId: row.accountId, count: parseInt(row.count, 10) }));
  }

  // ── Closing checklist ─────────────────────────────────────────────────────────────────────────

  /** Unposted (DRAFT or PENDING_APPROVAL) entries in a date range — for the closing checklist. */
  async countUnpostedEntriesInPeriod(
    organizationId: string,
    startDate: IsoDate,
    endDate: IsoDate,
  ): Promise<number> {
    return this.dataSource.manager.getRepository(JournalEntry).count({
      where: [
        {
          organizationId,
          status: JournalEntryStatus.DRAFT,
          date: Between(startDate as unknown as Date, endDate as unknown as Date),
        },
        {
          organizationId,
          status: JournalEntryStatus.PENDING_APPROVAL,
          date: Between(startDate as unknown as Date, endDate as unknown as Date),
        },
      ],
    });
  }

  /** Accruals flagged to reverse but not yet reversed — for the closing checklist. */
  async countPendingAccrualReversals(
    organizationId: string,
    beforeDate: IsoDate,
  ): Promise<number> {
    return this.dataSource.manager.getRepository(JournalEntry).count({
      where: {
        organizationId,
        reversesNextPeriod: true,
        isReversed: false,
        status: JournalEntryStatus.POSTED,
        date: LessThan(beforeDate as unknown as Date),
      },
    });
  }

  // ── Reconciliation ────────────────────────────────────────────────────────────────────────────

  /**
   * Fetch journal entry lines by id, with tenant and account scoping.
   *
   * The reconciliation matching flow needs to validate that the lines the user picked belong to
   * the right organisation and account, and that they are actually in the ledger.
   */
  async getEntryLinesForMatching(params: {
    lineIds: string[];
    organizationId: string;
    glAccountId: string;
    manager?: EntityManager;
  }): Promise<ReconciliationLineRow[]> {
    const { lineIds, organizationId, glAccountId, manager } = params;
    if (lineIds.length === 0) return [];

    const repo = (manager ?? this.dataSource.manager).getRepository(JournalEntryLine);
    const rows = await repo
      .createQueryBuilder('line')
      .innerJoin(JournalEntry, 'entry', 'entry.id = line.journal_entry_id')
      .where('line.id IN (:...ids)', { ids: lineIds })
      .andWhere('entry.organizationId = :organizationId', { organizationId })
      .andWhere('entry.status = :status', { status: JournalEntryStatus.POSTED })
      .andWhere('line.accountId = :accountId', { accountId: glAccountId })
      .select([
        'line.id AS id',
        'line.journal_entry_id AS "journalEntryId"',
        'line.accountId AS "accountId"',
        'line.currencyCode AS "currencyCode"',
        'line.foreignCurrencyDebit AS "foreignCurrencyDebit"',
        'line.foreignCurrencyCredit AS "foreignCurrencyCredit"',
        'line.isReconciled AS "isReconciled"',
      ])
      .getRawMany<{
        id: string;
        journalEntryId: string;
        accountId: string;
        currencyCode: string | null;
        foreignCurrencyDebit: string | null;
        foreignCurrencyCredit: string | null;
        isReconciled: boolean;
      }>();

    return rows.map((row) => ({
      id: row.id,
      journalEntryId: row.journalEntryId,
      accountId: row.accountId,
      currencyCode: row.currencyCode,
      foreignCurrencyDebit: row.foreignCurrencyDebit !== null ? Number(row.foreignCurrencyDebit) : null,
      foreignCurrencyCredit: row.foreignCurrencyCredit !== null ? Number(row.foreignCurrencyCredit) : null,
      isReconciled: Boolean(row.isReconciled),
    }));
  }

  /**
   * Fetch ledger valuations for the given line IDs and ledger.
   *
   * Used by the reconciliation matching algorithm to compare statement amounts against ledger
   * amounts in the same currency when the account is held in a foreign currency.
   */
  async getValuationsForLines(
    lineIds: string[],
    ledgerId: string,
    manager?: EntityManager,
  ): Promise<ValuationRow[]> {
    if (lineIds.length === 0) return [];
    const repo = (manager ?? this.dataSource.manager).getRepository(JournalEntryLineValuation);
    const rows = await repo
      .createQueryBuilder('valuation')
      .where('valuation.journalEntryLineId IN (:...ids)', { ids: lineIds })
      .andWhere('valuation.ledgerId = :ledgerId', { ledgerId })
      .select([
        'valuation.journalEntryLineId AS "journalEntryLineId"',
        'valuation.ledgerId AS "ledgerId"',
        'valuation.debit AS debit',
        'valuation.credit AS credit',
      ])
      .getRawMany<{
        journalEntryLineId: string;
        ledgerId: string;
        debit: string;
        credit: string;
      }>();

    return rows.map((row) => ({
      journalEntryLineId: row.journalEntryLineId,
      ledgerId: row.ledgerId,
      debit: Number(row.debit),
      credit: Number(row.credit),
    }));
  }

  /**
   * Mark journal entry lines as reconciled within the caller's transaction.
   *
   * The reconciliation flag lives on the journal entry line entity because it describes the state
   * of a specific ledger movement: matched against a bank statement line. Reconciliation calls
   * this method rather than updating the JE table directly.
   */
  async markLinesReconciled(
    lineIds: string[],
    manager: EntityManager,
  ): Promise<void> {
    if (lineIds.length === 0) return;
    await manager.update(
      JournalEntryLine,
      { id: In(lineIds) },
      { isReconciled: true, reconciledAt: new Date() },
    );
  }

  /** Undo `markLinesReconciled` when a match is removed. */
  async unmarkLinesReconciled(
    lineIds: string[],
    manager: EntityManager,
  ): Promise<void> {
    if (lineIds.length === 0) return;
    await manager.update(
      JournalEntryLine,
      { id: In(lineIds) },
      { isReconciled: false, reconciledAt: null },
    );
  }

  /**
   * Raw row data for bank-account ledger lines that have not been reconciled.
   *
   * The caller is responsible for resolving the ledger and for applying the currency-selection
   * logic (domestic vs. foreign account) to produce the final `amount` values — that decision
   * belongs to ReconciliationService, not to this query.
   */
  async getOutstandingLedgerLines(params: {
    organizationId: string;
    glAccountId: string;
    ledgerId: string;
    from: IsoDate | null;
    to: IsoDate;
    manager?: EntityManager;
  }): Promise<OutstandingLedgerLineRow[]> {
    const { organizationId, glAccountId, ledgerId, from, to, manager } = params;

    const qb = (manager ?? this.dataSource.manager)
      .createQueryBuilder(JournalEntryLine, 'line')
      .innerJoin(JournalEntry, 'entry', 'entry.id = line.journal_entry_id')
      .innerJoin(
        'journal_entry_line_valuations',
        'valuation',
        'valuation.journal_entry_line_id = line.id AND valuation.ledger_id = :ledgerId',
        { ledgerId },
      )
      .select([
        'line.id AS id',
        'entry.id AS "journalEntryId"',
        'entry.entry_number AS "entryNumber"',
        'entry.date AS date',
        'line.description AS description',
        'valuation.debit AS "baseDebit"',
        'valuation.credit AS "baseCredit"',
        'line.currency_code AS "lineCurrency"',
        'line.foreign_currency_debit AS "foreignDebit"',
        'line.foreign_currency_credit AS "foreignCredit"',
      ])
      .where('entry.organization_id = :organizationId', { organizationId })
      .andWhere('entry.status = :status', { status: JournalEntryStatus.POSTED })
      .andWhere('line.account_id = :glAccountId', { glAccountId })
      .andWhere('line.is_reconciled = false')
      .andWhere('entry.date <= :to', { to })
      .orderBy('entry.date', 'ASC');

    if (from) qb.andWhere('entry.date >= :from', { from });

    const rows = await qb.getRawMany<{
      id: string;
      journalEntryId: string;
      entryNumber: string | null;
      date: Date | string;
      description: string | null;
      baseDebit: string;
      baseCredit: string;
      lineCurrency: string | null;
      foreignDebit: string | null;
      foreignCredit: string | null;
    }>();

    return rows.map((row) => ({
      id: row.id,
      journalEntryId: row.journalEntryId,
      entryNumber: row.entryNumber,
      date: toIsoDate(row.date),
      description: row.description,
      baseDebit: Number(row.baseDebit),
      baseCredit: Number(row.baseCredit),
      lineCurrency: row.lineCurrency,
      foreignDebit: row.foreignDebit !== null ? Number(row.foreignDebit) : null,
      foreignCredit: row.foreignCredit !== null ? Number(row.foreignCredit) : null,
    }));
  }
}

/** Raw row returned by `getOutstandingLedgerLines`. */
export interface OutstandingLedgerLineRow {
  id: string;
  journalEntryId: string;
  entryNumber: string | null;
  date: IsoDate;
  description: string | null;
  baseDebit: number;
  baseCredit: number;
  lineCurrency: string | null;
  foreignDebit: number | null;
  foreignCredit: number | null;
}
