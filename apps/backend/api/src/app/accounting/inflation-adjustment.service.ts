import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  ISO_MONTH_PATTERN,
  isNominalAccountType,
  restatementDueAtClose,
  type InflationAdjustmentPolicy,
} from '@virtex/shared/types';
import { accountNameIn } from '../chart-of-accounts/chart-of-accounts-data-transfer.provider';
import { AccountingPostingPort, ModuleSlug } from '../journal-entries/accounting-posting.port';
import { CreateJournalEntryDto, CreateJournalEntryLineDto } from '../journal-entries/dto/create-journal-entry.dto';
import { LEDGER_STATUSES } from '../journal-entries/entities/journal-entry.entity';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { I18nService } from '../i18n/i18n.service';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../i18n/localized.exception';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { PriceIndicesService, monthStart, type ResolvedPriceIndexValue } from '../currencies/price-indices.service';
import { priceIndexSeries } from '../markets';
import { SYSTEM_JOURNALS } from '../contracts/ledger-posting/system-journals';
import { endOfMonthIso, toIsoDate, toIsoMonth, type IsoDate, type IsoMonth } from '../common/dates';
import { Ledger } from './entities/ledger.entity';
import { FiscalYear } from './entities/fiscal-year.entity';
import { AccountingPeriod } from './entities/accounting-period.entity';
import { InflationAdjustmentRun, InflationAdjustmentRunStatus, type UsedIndexValue } from './entities/inflation-adjustment-run.entity';
import { InflationAdjustmentRunLine } from './entities/inflation-adjustment-run-line.entity';
import { resolvePostingPeriod } from './period-status';
import { described } from '../contracts/ledger-posting/ledger-text';

/** The `system_reason` of the entries a restatement posts, and of their reversals. */
export const INFLATION_ADJUSTMENT_REASON = 'inflation-adjustment';
export const INFLATION_ADJUSTMENT_REVERSAL_REASON = 'inflation-adjustment-reversal';

/** Why a restatement cannot be computed or posted, as the catalogue key a person reads. */
export interface RestatementBlocker {
  key: string;
  params?: Record<string, unknown>;
}

/** One account (and dimension combination) of a restatement, as computed. */
export interface RestatementLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  /** Where the difference is posted: the account, or its restatement account. */
  postedAccountId: string;
  postedAccountCode: string;
  dimensions: Record<string, string> | null;
  /** Debit-positive amounts, as decimal text with two places. */
  historical: string;
  restated: string;
  bookBalance: string;
  adjustment: string;
  /** `YYYY-MM`: the earliest month any of its amounts originated in. */
  earliestOrigin: IsoMonth | null;
}

export interface RestatementRunSummary {
  id: string;
  period: IsoMonth;
  status: InflationAdjustmentRunStatus;
  journalEntryId: string | null;
  reversalEntryId: string | null;
  netMonetaryResult: string;
  lineCount: number;
  ranAt: string;
  ranByUserId: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  seriesCode: string;
  closingIndex: string;
}

/** What restating a month would do, computed and not posted. */
export interface RestatementPlan {
  period: IsoMonth;
  entryDate: IsoDate;
  ledgerId: string | null;
  ledgerName: string | null;
  currency: string | null;
  policy: InflationAdjustmentPolicy;
  seriesCode: string | null;
  seriesName: string | null;
  closingIndex: ResolvedPriceIndexValue | null;
  /** Months whose amounts need an index the series does not have yet. */
  missingIndexMonths: IsoMonth[];
  /** Only the lines whose restatement differs from the books: the entry's lines. */
  lines: RestatementLine[];
  /** Every account restated, the unchanged ones too: what the screen shows. */
  accounts: RestatementLine[];
  /** Debit-positive on the account of the net monetary position: `−Σ adjustments`. */
  netMonetaryResult: string;
  netMonetaryAccountId: string | null;
  /** Every month multiplied by, with the value and revision read. */
  indexValues: Record<IsoMonth, UsedIndexValue>;
  blockers: RestatementBlocker[];
}

/** The plan, with what the books already hold for the month: for the screen and the checklist. */
export interface RestatementOutlook extends RestatementPlan {
  /** Whether the close of the period that ends on `entryDate` restates the books by policy. */
  dueAtClose: boolean;
  /** The POSTED run of the month, if any. */
  run: RestatementRunSummary | null;
  /**
   * With a run in the books: whether it still holds — same indices, no posting since that would
   * change it. False means the close (or «replace») books the difference.
   */
  current: boolean | null;
  /** The plan of a replacement of that run: the full restatement, as if it had not been posted. */
  replacement: RestatementPlan | null;
}

interface AccountGroup {
  sourceId: string;
  targetId: string | null;
  nominal: boolean;
  code: string;
  name: string;
  targetCode: string | null;
}

/** Decimal text → cents, exactly: `-1234.5` → `-123450n`. */
export function centsOf(text: string | number | null | undefined): bigint {
  if (text === null || text === undefined) return 0n;
  const raw = String(text).trim();
  if (!raw) return 0n;
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = raw.replace(/^[-+]/, '').split('.');
  const cents = BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -cents : cents;
}

/** Cents → decimal text with two places: `-123450n` → `-1234.50`. */
export function textOf(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const text = `${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/** Cents → the number a journal line takes. Exact for any amount a ledger holds (< 2^53 cents). */
function amountOf(cents: bigint): number {
  return Number(cents) / 100;
}

/**
 * Restatement of the books for inflation (IAS 29; Argentina RT 6, Venezuela BA VEN-NIF 2 — each to
 * be confirmed with a local accountant). Audit 2026-11-07, FIN-AC-04.
 *
 * ## What it used to do
 *
 * `balance × monthly rate`, from a per-organization rate table nothing could fill, with the balance
 * read at the END of the month — so the month's own purchases were inflated by the month's
 * inflation — no notion of when an amount originated, and nothing to stop the same month being
 * restated twice. The journal it posted to did not exist.
 *
 * ## What it does
 *
 * Every amount on a restated (non-monetary) account is a LAYER dated by the month it originated —
 * the entry's date, or the line's own origin when a subledger knows better (an asset's acquisition
 * for its depreciation). The restated balance at the end of month M is
 *
 *     Σ layer × index(M) / index(origin of the layer)
 *
 * and the run posts the difference between that and what the books already carry, previous
 * restatements included. Because each run computes the whole restated balance from the layers, it
 * is right whether the months before it were restated or not, and a late posting into an earlier
 * month is caught by the next run instead of being lost.
 *
 *  - Income and expenses restart every fiscal year: only the year's layers are restated.
 *  - An account restated into an account of its own (capital → «Ajuste de capital») is one group:
 *    the layers of both, the balance of both, the difference posted to the second.
 *  - By dimension combination, so a cost centre keeps its own figures, as the year-end close does;
 *    the counterpart — the gain or loss on the net monetary position (IAS 29.27) — takes the
 *    opposite of each combination, and the entry balances by construction.
 *  - Arithmetic in PostgreSQL `numeric`, rounded once per account: an index is exact decimal text
 *    from the table to the coefficient.
 *  - One POSTED run per ledger and month. Running again returns it; «replace» reverses it and books
 *    the current figure; a run is only undone when no later month was restated after it, because
 *    the later run included it.
 */
@Injectable()
export class InflationAdjustmentService {
  private readonly logger = new Logger(InflationAdjustmentService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly posting: AccountingPostingPort,
    private readonly indices: PriceIndicesService,
    private readonly journalLookup: JournalLookupService,
    /** Narratives in the tenant's books language; see `LedgerNarrativeService`. */
    private readonly narrative: LedgerNarrativeService = new LedgerNarrativeService(new I18nService()),
  ) {}

  // ── Reading ────────────────────────────────────────────────────────────────────────────────

  /** What the month's restatement would book, and what the books already hold for it. */
  async outlook(organizationId: string, period: IsoMonth, options: { ledgerId?: string; manager?: EntityManager } = {}): Promise<RestatementOutlook> {
    assertPeriod(period);
    const manager = options.manager ?? this.dataSource.manager;
    const plan = await this.plan(manager, organizationId, period, { ledgerId: options.ledgerId });
    const run = plan.ledgerId ? await this.postedRun(manager, organizationId, plan.ledgerId, period) : null;
    const dueAtClose = restatementDueAtClose(plan.policy, await this.isLastPeriodOfYear(manager, organizationId, plan.entryDate));
    const replacement =
      run && run.journalEntryId
        ? await this.plan(manager, organizationId, period, { ledgerId: plan.ledgerId ?? undefined, excludeEntryIds: [run.journalEntryId] })
        : null;
    return {
      ...plan,
      dueAtClose,
      run: run ? summarise(run) : null,
      current: run ? plan.blockers.length === 0 && plan.lines.length === 0 : null,
      replacement,
    };
  }

  /** The runs of a ledger, newest month first. */
  async listRuns(organizationId: string, options: { ledgerId?: string; year?: number } = {}): Promise<RestatementRunSummary[]> {
    const qb = this.dataSource.manager
      .createQueryBuilder(InflationAdjustmentRun, 'run')
      .where('run.organizationId = :organizationId', { organizationId })
      .orderBy('run.period', 'DESC')
      .addOrderBy('run.ranAt', 'DESC');
    if (options.ledgerId) qb.andWhere('run.ledgerId = :ledgerId', { ledgerId: options.ledgerId });
    if (options.year) {
      qb.andWhere('run.period BETWEEN :from AND :to', { from: `${options.year}-01-01`, to: `${options.year}-12-01` });
    }
    return (await qb.getMany()).map(summarise);
  }

  /** A run with the figure of every account it restated. */
  async getRun(organizationId: string, runId: string): Promise<RestatementRunSummary & { lines: RestatementLine[]; indexValues: Record<string, UsedIndexValue> }> {
    const run = await this.dataSource.manager.findOne(InflationAdjustmentRun, { where: { id: runId, organizationId } });
    if (!run) throw new NotFoundError('inflation_adjustment.run_not_found');
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT l.account_id AS "accountId", a.code AS "accountCode", a.name AS "accountName",
              l.posted_account_id AS "postedAccountId", p.code AS "postedAccountCode", l.dimensions,
              l.historical::text AS historical, l.restated::text AS restated,
              l.book_balance::text AS "bookBalance", l.adjustment::text AS adjustment,
              to_char(l.earliest_origin, 'YYYY-MM') AS "earliestOrigin", o.books_language AS "booksLanguage"
         FROM inflation_adjustment_run_lines l
         JOIN accounts a ON a.id = l.account_id
         JOIN accounts p ON p.id = l.posted_account_id
         JOIN organizations o ON o.id = l.organization_id
        WHERE l.run_id = $1 AND l.organization_id = $2
        ORDER BY a.code, l.dimensions::text`,
      [runId, organizationId],
    );
    return {
      ...summarise(run),
      indexValues: run.indexValues,
      lines: rows.map((row) => ({
        accountId: row['accountId'] as string,
        accountCode: row['accountCode'] as string,
        accountName: accountNameIn(row['accountName'], row['booksLanguage'] as string | null),
        postedAccountId: row['postedAccountId'] as string,
        postedAccountCode: row['postedAccountCode'] as string,
        dimensions: (row['dimensions'] as Record<string, string> | null) ?? null,
        historical: row['historical'] as string,
        restated: row['restated'] as string,
        bookBalance: row['bookBalance'] as string,
        adjustment: row['adjustment'] as string,
        earliestOrigin: (row['earliestOrigin'] as string | null) ?? null,
      })),
    };
  }

  // ── Posting ────────────────────────────────────────────────────────────────────────────────

  /**
   * Restate a ledger at the end of `period` (`YYYY-MM`).
   *
   * Idempotent: with a POSTED run for the month it returns that run (`created: false`), unless
   * `replace` — then that run is reversed and the current figure booked. Refused while a later
   * month is restated (it already includes this one), for a closed period, without a series, an
   * index or the account of the net monetary position.
   */
  async run(
    organizationId: string,
    period: IsoMonth,
    actorUserId: string | null,
    options: { ledgerId?: string; replace?: boolean; manager?: EntityManager } = {},
  ): Promise<{ run: InflationAdjustmentRun; created: boolean }> {
    assertPeriod(period);
    const execute = async (manager: EntityManager) => {
      const ledger = await this.ledgerOf(manager, organizationId, options.ledgerId);
      await this.lock(manager, organizationId, ledger.id);
      await this.assertNoLaterRun(manager, organizationId, ledger.id, period);

      const existing = await this.postedRun(manager, organizationId, ledger.id, period);
      if (existing && !options.replace) return { run: existing, created: false };

      const plan = await this.plan(manager, organizationId, period, {
        ledgerId: ledger.id,
        excludeEntryIds: existing?.journalEntryId ? [existing.journalEntryId] : [],
      });
      if (plan.blockers.length > 0) {
        const [first] = plan.blockers;
        throw new UnprocessableEntityError(first.key, first.params ?? {});
      }
      // The period must take postings — a closed one is refused here (409), a missing one too (422)
      // — even when nothing needs booking, so a run never records a month nobody could post into.
      await resolvePostingPeriod(manager, organizationId, plan.entryDate, ModuleSlug.GL, { createIfMissing: false });

      if (existing) await this.undo(manager, organizationId, existing, actorUserId, 'replaced');
      const run = await this.book(manager, organizationId, ledger, plan, actorUserId);
      return { run, created: true };
    };
    return options.manager ? execute(options.manager) : this.dataSource.transaction(execute);
  }

  /**
   * Undo a run: its entry reversed on its own date, the run kept as REVERSED. Only the latest
   * restated month of the ledger can be undone — a later run was computed on top of this one.
   */
  async reverse(organizationId: string, runId: string, actorUserId: string | null, reason: string): Promise<InflationAdjustmentRun> {
    return this.dataSource.transaction(async (manager) => {
      const found = await manager.findOne(InflationAdjustmentRun, { where: { id: runId, organizationId } });
      if (!found) throw new NotFoundError('inflation_adjustment.run_not_found');
      await this.lock(manager, organizationId, found.ledgerId);
      const run = await manager.findOneOrFail(InflationAdjustmentRun, { where: { id: runId, organizationId } });
      if (run.status !== InflationAdjustmentRunStatus.POSTED) {
        throw new ConflictError('inflation_adjustment.run_already_reversed');
      }
      await this.assertNoLaterRun(manager, organizationId, run.ledgerId, toIsoMonth(run.period));
      return this.undo(manager, organizationId, run, actorUserId, reason);
    });
  }

  /**
   * The restatement the close of a period books, when the company's policy calls for it there:
   * nothing when the month's run still holds, the run when there is none, a replacement when the
   * books moved since. On the close's own transaction, before the period is locked.
   */
  async runForClose(
    organizationId: string,
    period: { startDate: Date | string; endDate: Date | string },
    manager: EntityManager,
  ): Promise<{ performed: boolean; runId: string | null; due: boolean }> {
    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    const entryDate = toIsoDate(period.endDate);
    const due = restatementDueAtClose(settings?.inflationAdjustmentPolicy, await this.isLastPeriodOfYear(manager, organizationId, entryDate));
    if (!due) return { performed: false, runId: null, due: false };
    const month = toIsoMonth(entryDate);
    const ledger = await this.ledgerOf(manager, organizationId);
    const existing = await this.postedRun(manager, organizationId, ledger.id, month);
    if (existing) {
      const now = await this.plan(manager, organizationId, month, { ledgerId: ledger.id });
      if (now.blockers.length === 0 && now.lines.length === 0) return { performed: false, runId: existing.id, due: true };
    }
    const { run } = await this.run(organizationId, month, null, { ledgerId: ledger.id, replace: Boolean(existing), manager });
    return { performed: true, runId: run.id, due: true };
  }

  // ── The computation ────────────────────────────────────────────────────────────────────────

  /**
   * The restatement of a ledger at the end of `period`, computed and not posted.
   *
   * `excludeEntryIds` leaves entries out of the books' balance — the entry of a run about to be
   * replaced — so the plan is the full restatement, not the difference to it.
   */
  async plan(
    manager: EntityManager,
    organizationId: string,
    period: IsoMonth,
    options: { ledgerId?: string; excludeEntryIds?: string[] } = {},
  ): Promise<RestatementPlan> {
    assertPeriod(period);
    const entryDate = endOfMonthIso(monthStart(period));
    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    const policy: InflationAdjustmentPolicy = settings?.inflationAdjustmentPolicy ?? 'NONE';
    const seriesCode = settings?.inflationIndexSeriesCode ?? null;
    const series = priceIndexSeries(seriesCode);
    const ledger = await this.ledgerOf(manager, organizationId, options.ledgerId).catch(() => null);
    const netMonetaryAccountId = settings?.defaultInflationAdjustmentAccountId ?? null;

    const plan: RestatementPlan = {
      period,
      entryDate,
      ledgerId: ledger?.id ?? null,
      ledgerName: ledger?.name ?? null,
      currency: ledger?.currency ?? null,
      policy,
      seriesCode,
      seriesName: series?.name ?? null,
      closingIndex: null,
      missingIndexMonths: [],
      lines: [],
      accounts: [],
      netMonetaryResult: '0.00',
      netMonetaryAccountId,
      indexValues: {},
      blockers: [],
    };

    if (!ledger) plan.blockers.push({ key: 'inflation_adjustment.no_ledger' });
    if (!series) plan.blockers.push({ key: 'inflation_adjustment.series_not_configured' });
    if (ledger && series && (ledger.currency ?? '').toUpperCase() !== series.currency) {
      plan.blockers.push({
        key: 'inflation_adjustment.series_currency_differs',
        params: { series: series.code, currency: series.currency, ledgerCurrency: ledger.currency ?? '' },
      });
    }
    if (!netMonetaryAccountId) plan.blockers.push({ key: 'inflation_adjustment.net_monetary_account_missing' });
    const fiscalYear = await manager
      .createQueryBuilder(FiscalYear, 'year')
      .where('year.organizationId = :organizationId', { organizationId })
      .andWhere(':date BETWEEN year.startDate AND year.endDate', { date: entryDate })
      .getOne();
    if (!fiscalYear) plan.blockers.push({ key: 'inflation_adjustment.no_fiscal_year', params: { date: entryDate } });
    if (!ledger || !series || !fiscalYear) return plan;

    const groups = await this.groups(manager, organizationId, netMonetaryAccountId);
    // Reference data, read on its own like the closing rates: an index is not part of the
    // transaction that restates with it, and recording one never waits on a restatement.
    const resolved = await this.indices.resolve(organizationId, series.code, '1900-01', period);
    const closing = resolved.get(period) ?? null;
    plan.closingIndex = closing;
    if (!closing) {
      // Nothing can be expressed in the unit of a month whose index is not known yet.
      plan.blockers.push({ key: 'inflation_adjustment.closing_index_missing', params: { series: series.code, period } });
      return plan;
    }
    if (groups.length === 0) return plan;

    const months = [...resolved.keys()];
    const rows: Array<{
      source_id: string;
      dims: Record<string, string>;
      historical: string;
      restated: string | null;
      book: string;
      earliest: string | null;
      missing: string[] | null;
      used: string[] | null;
    }> = await manager.query(
      `
      WITH grp AS (
        SELECT * FROM unnest($3::uuid[], $4::uuid[], $5::boolean[]) AS g(source_id, target_id, nominal)
      ), member AS (
        SELECT source_id AS account_id, source_id, nominal FROM grp
        UNION ALL
        SELECT target_id, source_id, nominal FROM grp WHERE target_id IS NOT NULL
      ), movement AS (
        SELECT m.source_id,
               COALESCE(l.dimensions, '{}'::jsonb) AS dims,
               date_trunc('month', COALESCE(l.origin_date, e.date))::date AS origin,
               (v.debit - v.credit) AS amount,
               COALESCE(e.system_reason, '') IN ($9, $10) AS restatement
          FROM journal_entry_lines l
          JOIN journal_entries e ON e.id = l.journal_entry_id
          JOIN journal_entry_line_valuations v ON v.journal_entry_line_id = l.id AND v.ledger_id = $2
          JOIN member m ON m.account_id = l.account_id
         WHERE e.organization_id = $1
           AND e.status = ANY($11::journal_entries_status_enum[])
           AND e.date <= $6::date
           AND (NOT m.nominal OR e.date >= $7::date)
           AND NOT (e.id = ANY($8::uuid[]))
      ), idx AS (
        SELECT * FROM unnest($12::date[], $13::numeric[]) AS i(month, value)
      ), layer AS (
        SELECT source_id, dims, origin, SUM(amount) AS amount
          FROM movement WHERE NOT restatement
         GROUP BY 1, 2, 3
      ), book AS (
        SELECT source_id, dims, SUM(amount) AS balance FROM movement GROUP BY 1, 2
      ), restated AS (
        SELECT l.source_id, l.dims,
               SUM(l.amount) AS historical,
               ROUND(SUM(l.amount * $14::numeric / i.value) FILTER (WHERE l.amount <> 0), 2) AS restated,
               MIN(l.origin) FILTER (WHERE l.amount <> 0) AS earliest,
               array_agg(DISTINCT to_char(l.origin, 'YYYY-MM')) FILTER (WHERE i.value IS NULL AND l.amount <> 0) AS missing,
               array_agg(DISTINCT to_char(l.origin, 'YYYY-MM')) FILTER (WHERE i.value IS NOT NULL AND l.amount <> 0) AS used
          FROM layer l LEFT JOIN idx i ON i.month = l.origin
         GROUP BY 1, 2
      )
      SELECT COALESCE(r.source_id, b.source_id) AS source_id,
             COALESCE(r.dims, b.dims) AS dims,
             COALESCE(r.historical, 0)::text AS historical,
             r.restated::text AS restated,
             COALESCE(b.balance, 0)::text AS book,
             to_char(r.earliest, 'YYYY-MM') AS earliest,
             r.missing, r.used
        FROM restated r
        FULL JOIN book b ON b.source_id = r.source_id AND b.dims = r.dims
      `,
      [
        organizationId,
        ledger.id,
        groups.map((group) => group.sourceId),
        groups.map((group) => group.targetId),
        groups.map((group) => group.nominal),
        entryDate,
        toIsoDate(fiscalYear.startDate),
        options.excludeEntryIds ?? [],
        INFLATION_ADJUSTMENT_REASON,
        INFLATION_ADJUSTMENT_REVERSAL_REASON,
        [...LEDGER_STATUSES],
        months.map(monthStart),
        months.map((month) => (resolved.get(month) as ResolvedPriceIndexValue).value),
        closing.value,
      ],
    );

    const byId = new Map(groups.map((group) => [group.sourceId, group]));
    const missing = new Set<string>();
    const used = new Set<string>();
    let netCents = 0n;
    for (const row of rows) {
      for (const month of row.missing ?? []) missing.add(month);
      for (const month of row.used ?? []) used.add(month);
      const group = byId.get(row.source_id) as AccountGroup;
      const restatedCents = centsOf(row.restated);
      const bookCents = centsOf(row.book);
      const adjustmentCents = restatedCents - bookCents;
      const dimensions = row.dims && Object.keys(row.dims).length > 0 ? row.dims : null;
      const line: RestatementLine = {
        accountId: group.sourceId,
        accountCode: group.code,
        accountName: group.name,
        postedAccountId: group.targetId ?? group.sourceId,
        postedAccountCode: group.targetCode ?? group.code,
        dimensions,
        historical: textOf(centsOf(row.historical)),
        restated: textOf(restatedCents),
        bookBalance: textOf(bookCents),
        adjustment: textOf(adjustmentCents),
        earliestOrigin: row.earliest,
      };
      if (restatedCents === 0n && bookCents === 0n && centsOf(row.historical) === 0n) continue;
      plan.accounts.push(line);
      if (adjustmentCents !== 0n) {
        plan.lines.push(line);
        netCents -= adjustmentCents;
      }
    }
    const order = (a: RestatementLine, b: RestatementLine) =>
      a.accountCode.localeCompare(b.accountCode) || JSON.stringify(a.dimensions ?? {}).localeCompare(JSON.stringify(b.dimensions ?? {}));
    plan.accounts.sort(order);
    plan.lines.sort(order);
    plan.netMonetaryResult = textOf(netCents);
    plan.missingIndexMonths = [...missing].sort();
    if (plan.missingIndexMonths.length > 0) {
      plan.blockers.push({
        key: 'inflation_adjustment.index_missing',
        params: { series: series.code, months: plan.missingIndexMonths.join(', ') },
      });
    }
    for (const month of [...used, ...(closing ? [period] : [])].sort()) {
      const value = resolved.get(month);
      if (value) plan.indexValues[month] = { value: value.value, revision: value.revision, source: value.source, valueId: value.valueId };
    }
    return plan;
  }

  // ── Internals ──────────────────────────────────────────────────────────────────────────────

  /** Post the plan and record the run. */
  private async book(
    manager: EntityManager,
    organizationId: string,
    ledger: Ledger,
    plan: RestatementPlan,
    actorUserId: string | null,
  ): Promise<InflationAdjustmentRun> {
    const runs = manager.getRepository(InflationAdjustmentRun);
    const run = await runs.save(
      runs.create({
        organizationId,
        ledgerId: ledger.id,
        period: monthStart(plan.period),
        entryDate: plan.entryDate,
        seriesCode: plan.seriesCode as string,
        closingIndex: (plan.closingIndex as ResolvedPriceIndexValue).value,
        indexValues: plan.indexValues,
        status: InflationAdjustmentRunStatus.POSTED,
        journalEntryId: null,
        reversalEntryId: null,
        netMonetaryResult: plan.netMonetaryResult,
        lineCount: plan.lines.length,
        ranByUserId: actorUserId,
      }),
    );

    if (plan.lines.length > 0) {
      const words = await this.narrative.describeAll(manager, organizationId, {
        line: { key: 'ledger.inflation.line', params: { period: plan.period } },
        counterpart: { key: 'ledger.inflation.counterpart', params: { period: plan.period } },
        header: { key: 'ledger.inflation.entry', params: { period: plan.period } },
      });
      const journal = await this.journalLookup.requireByCode(organizationId, SYSTEM_JOURNALS.inflationAdjustment.code, manager);
      const lines: CreateJournalEntryLineDto[] = [];
      /** The net of each dimension combination, which its counterpart line takes the other side of. */
      const byCombination = new Map<string, { dimensions: Record<string, string> | null; cents: bigint }>();
      for (const line of plan.lines) {
        const cents = centsOf(line.adjustment);
        const debit = cents > 0n ? amountOf(cents) : 0;
        const credit = cents < 0n ? amountOf(-cents) : 0;
        lines.push({
          accountId: line.postedAccountId,
          debit,
          credit,
          ...described(words.line),
          ...(line.dimensions ? { dimensions: line.dimensions } : {}),
          valuations: [{ ledgerId: ledger.id, debit, credit }],
        });
        const key = JSON.stringify(line.dimensions ?? null);
        const slot = byCombination.get(key) ?? { dimensions: line.dimensions, cents: 0n };
        slot.cents += cents;
        byCombination.set(key, slot);
      }
      for (const slot of byCombination.values()) {
        if (slot.cents === 0n) continue;
        // The opposite of what the combination's restatement netted to: a net restatement of
        // non-monetary items upward is a loss on the net monetary position, and the reverse.
        const debit = slot.cents < 0n ? amountOf(-slot.cents) : 0;
        const credit = slot.cents > 0n ? amountOf(slot.cents) : 0;
        lines.push({
          accountId: plan.netMonetaryAccountId as string,
          debit,
          credit,
          ...described(words.counterpart),
          ...(slot.dimensions ? { dimensions: slot.dimensions } : {}),
          valuations: [{ ledgerId: ledger.id, debit, credit }],
        });
      }
      const entry = await this.posting.createWithManager(
        manager,
        {
          date: plan.entryDate,
          ...described(words.header),
          journalId: journal.id,
          ledgerId: ledger.id,
          lines,
        } as CreateJournalEntryDto,
        organizationId,
        {
          actorUserId,
          systemReason: INFLATION_ADJUSTMENT_REASON,
          idempotencyKey: `inflation-adjustment:${run.id}`,
          // The tags are those of the balances restated, copied from the ledger.
          tagsFromLedger: true,
        },
      );
      run.journalEntryId = entry.id;
      await runs.update({ id: run.id, organizationId }, { journalEntryId: entry.id });
    }

    if (plan.accounts.length > 0) {
      await manager.getRepository(InflationAdjustmentRunLine).insert(
        plan.accounts.map((line) => ({
          organizationId,
          runId: run.id,
          accountId: line.accountId,
          postedAccountId: line.postedAccountId,
          dimensions: line.dimensions,
          historical: line.historical,
          restated: line.restated,
          bookBalance: line.bookBalance,
          adjustment: line.adjustment,
          earliestOrigin: line.earliestOrigin ? monthStart(line.earliestOrigin) : null,
        })),
      );
    }
    this.logger.log(
      `Reexpresión ${plan.period} en ${ledger.name} (${organizationId}): ${plan.lines.length} líneas, RECPAM ${plan.netMonetaryResult}.`,
    );
    return run;
  }

  /** Reverse a run's entry and mark it REVERSED. */
  private async undo(
    manager: EntityManager,
    organizationId: string,
    run: InflationAdjustmentRun,
    actorUserId: string | null,
    reason: string,
  ): Promise<InflationAdjustmentRun> {
    let reversalEntryId: string | null = null;
    if (run.journalEntryId) {
      const reversal = await this.posting.createSystemReversal(
        run.journalEntryId,
        organizationId,
        { reversalDate: toIsoDate(run.entryDate), reason },
        manager,
        { actorUserId, systemReason: INFLATION_ADJUSTMENT_REVERSAL_REASON },
      );
      reversalEntryId = reversal.id;
    }
    const changes = {
      status: InflationAdjustmentRunStatus.REVERSED,
      reversalEntryId,
      reversedAt: new Date(),
      reversedByUserId: actorUserId,
      reversalReason: reason,
    };
    await manager.update(InflationAdjustmentRun, { id: run.id, organizationId }, changes);
    return Object.assign(run, changes);
  }

  /** The accounts restated, each with its restatement account, as groups of the computation. */
  private async groups(manager: EntityManager, organizationId: string, netMonetaryAccountId: string | null): Promise<AccountGroup[]> {
    const rows: Array<{ id: string; code: string; name: unknown; type: string; target_id: string | null; target_code: string | null; language: string | null }> =
      await manager.query(
        `SELECT a.id, a.code, a.name, a.type, t.id AS target_id, t.code AS target_code, o.books_language AS language
           FROM accounts a
           JOIN organizations o ON o.id = a.organization_id
           LEFT JOIN accounts t ON t.id = a.inflation_adjustment_account_id
          WHERE a.organization_id = $1 AND a.is_inflation_adjustable AND a."isPostable"
            AND a.id IS DISTINCT FROM $2::uuid
            -- An account that takes another's restatement belongs to that account's group, never
            -- to a group of its own: counted twice, its balance would be restated twice.
            AND NOT EXISTS (SELECT 1 FROM accounts s WHERE s.organization_id = a.organization_id AND s.inflation_adjustment_account_id = a.id)
          ORDER BY a.code`,
        [organizationId, netMonetaryAccountId],
      );
    return rows.map((row) => ({
      sourceId: row.id,
      targetId: row.target_id,
      nominal: isNominalAccountType(row.type),
      code: row.code,
      name: accountNameIn(row.name, row.language),
      targetCode: row.target_code,
    }));
  }

  private async ledgerOf(manager: EntityManager, organizationId: string, ledgerId?: string): Promise<Ledger> {
    const ledger = ledgerId
      ? await manager.findOne(Ledger, { where: { id: ledgerId, organizationId } })
      : ((await manager.findOne(Ledger, { where: { organizationId, isDefault: true } })) ??
        (await manager.findOne(Ledger, { where: { organizationId }, order: { createdAt: 'ASC' } })));
    if (!ledger) throw new UnprocessableEntityError('inflation_adjustment.no_ledger');
    return ledger;
  }

  private postedRun(manager: EntityManager, organizationId: string, ledgerId: string, period: IsoMonth): Promise<InflationAdjustmentRun | null> {
    return manager.findOne(InflationAdjustmentRun, {
      where: { organizationId, ledgerId, period: monthStart(period), status: InflationAdjustmentRunStatus.POSTED },
    });
  }

  /** A later month restated was computed on top of this one: it must be undone first. */
  private async assertNoLaterRun(manager: EntityManager, organizationId: string, ledgerId: string, period: IsoMonth): Promise<void> {
    const [later]: Array<{ period: string }> = await manager.query(
      `SELECT to_char(period, 'YYYY-MM') AS period FROM inflation_adjustment_runs
        WHERE organization_id = $1 AND ledger_id = $2 AND status = 'POSTED' AND period > $3::date
        ORDER BY period DESC LIMIT 1`,
      [organizationId, ledgerId, monthStart(period)],
    );
    if (later) throw new ConflictError('inflation_adjustment.later_period_restated', { period, later: later.period });
  }

  /** One restatement of a ledger at a time: two would both read the books before the other posted. */
  private async lock(manager: EntityManager, organizationId: string, ledgerId: string): Promise<void> {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`inflation-adjustment:${organizationId}:${ledgerId}`]);
  }

  /** Whether `date` is the last day of a fiscal year's last period. */
  private async isLastPeriodOfYear(manager: EntityManager, organizationId: string, date: IsoDate): Promise<boolean> {
    const period = await manager
      .createQueryBuilder(AccountingPeriod, 'period')
      .where('period.organizationId = :organizationId', { organizationId })
      .andWhere('period.endDate = :date', { date })
      .getOne();
    if (!period) return false;
    const year = await manager
      .createQueryBuilder(FiscalYear, 'year')
      .where('year.organizationId = :organizationId', { organizationId })
      .andWhere('year.endDate = :date', { date })
      .getOne();
    return Boolean(year);
  }
}

function assertPeriod(period: string): void {
  if (typeof period !== 'string' || !ISO_MONTH_PATTERN.test(period)) {
    throw new UnprocessableEntityError('inflation_adjustment.period_invalid', { period: String(period) });
  }
}

function summarise(run: InflationAdjustmentRun): RestatementRunSummary {
  return {
    id: run.id,
    period: toIsoMonth(run.period),
    status: run.status,
    journalEntryId: run.journalEntryId,
    reversalEntryId: run.reversalEntryId,
    netMonetaryResult: String(run.netMonetaryResult),
    lineCount: run.lineCount,
    ranAt: new Date(run.ranAt).toISOString(),
    ranByUserId: run.ranByUserId,
    reversedAt: run.reversedAt ? new Date(run.reversedAt).toISOString() : null,
    reversalReason: run.reversalReason,
    seriesCode: run.seriesCode,
    closingIndex: run.closingIndex,
  };
}

