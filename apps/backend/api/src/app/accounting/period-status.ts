import { EntityManager, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import {
  AccountingPeriod,
  ModuleSlug,
  PeriodStatus,
} from './entities/accounting-period.entity';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import { ensureFiscalYearWithPeriods } from './provisioning/fiscal-calendar';
import { ConflictError, UnprocessableEntityError } from '../i18n/localized.exception';
import { toIsoDate } from '../chart-of-accounts/account-balances.service';
import { fiscalDate, organizationTimeZone } from '../shared/fiscal-clock';

/**
 * Whether a date may be posted to, and by which subledger.
 *
 * ## Why this is a plain function
 *
 * It is needed by the posting path, by the HTTP guard that runs before it, and by the close. A
 * Nest provider would make `JournalEntriesModule` and `AccountingModule` mutually dependent, so
 * this takes an `EntityManager` and stays out of the DI graph. Having one implementation is the
 * point: the guard and the service used to check different things, and the four per-module period
 * statuses were checked by neither.
 *
 * ## The module statuses were decoration
 *
 * `accounting_periods` carries `gl_status`, `ap_status`, `ar_status` and `inv_status`, and the API
 * exposes routes to close and reopen each. Nothing read them. Closing accounts payable for March
 * did not stop a March supplier invoice from being booked. Every caller now names the subledger it
 * is posting on behalf of, and both that status and the period's overall status have to be open.
 */
export async function resolvePostingPeriod(
  manager: EntityManager,
  organizationId: string,
  date: Date | string,
  module: ModuleSlug = ModuleSlug.GL,
  options: {
    /**
     * Allow the entry into a period that has been closed.
     *
     * The single exception, and it exists for one entry type: an audit adjustment. An external
     * audit's whole purpose is to correct a year that has already been closed, and the previous
     * arrangement made that impossible — `createAuditAdjustment` required a fiscal year that was
     * *not* open, and then posted through this function, which refuses every closed period. The
     * two requirements could not both be met, so the feature could not run at all.
     *
     * Never granted for a locked (archived) fiscal year, which is checked by the caller, and never
     * for an ordinary posting. The entry that uses it is typed `AUDIT_ADJUSTMENT`, carries its own
     * `system_reason`, and reaches this point only through an approved proposal — so the exception
     * is visible in the ledger rather than being a hole in the period control.
     */
    allowClosedPeriod?: boolean;
    /**
     * Open the fiscal year the date belongs to, on demand, when no period covers it yet.
     *
     * The calendar of a year nobody has opened used to be a wall: provisioning creates the current
     * year, the year-end close opens the next, and anything else — a transaction dated into the
     * following year, a backlog imported from a prior one — hit "la fecha no pertenece a ningún
     * período" with no way forward from the product. With this set, the year is materialised the
     * first time a posting needs it, idempotently and in the same calendar-month shape provisioning
     * uses. The posting paths pass it; the read-only reports that merely ask "is this date open?"
     * do not. Never materialises a year that is closed or locked (a sealed book), and never one so
     * far from the present that the date can only be a typo — see {@link materialisePeriodForDate}.
     */
    createIfMissing?: boolean;
  } = {},
): Promise<AccountingPeriod> {
  const isoDate = toIsoDate(date);

  // Before anything else, and before a fiscal year can be opened for it: a date past the company's
  // horizon is refused, whatever periods exist (FIN-JE-02).
  const horizon = await postingHorizon(manager, organizationId);
  if (isoDate > horizon.limit) {
    throw new UnprocessableEntityError('accounting.posting_date_beyond_horizon', {
      date: isoDate,
      limit: horizon.limit,
      days: horizon.days,
    });
  }

  let period = await findPeriodCovering(manager, organizationId, isoDate);

  if (!period && options.createIfMissing) {
    period = await materialisePeriodForDate(manager, organizationId, isoDate);
  }

  if (!period) {
    throw new UnprocessableEntityError(
      'accounting.transaction_date_p1_does_not_fall',
      { p1: isoDate },
    );
  }

  // Shared lock for the rest of the posting transaction, then the status read AFTER it: a close
  // (which takes the row exclusively) either finishes first — and this sees CLOSED — or waits for
  // this posting to commit. Postings do not block each other. (Audit 2026-10-31, GL-04.)
  await manager.query(`SELECT "id" FROM "accounting_periods" WHERE "id" = $1 FOR SHARE`, [period.id]);
  period = (await manager.findOneBy(AccountingPeriod, { id: period.id })) ?? period;

  if (period.status === PeriodStatus.CLOSED && !options.allowClosedPeriod) {
    throw new ConflictError(
      'accounting.transaction_date_falls_accounting_period_name',
      { name: period.name },
    );
  }

  // The subledger windows are not waived by the exception above: an audit adjustment is a general
  // ledger entry, and letting it into a closed payables month would put it in a subledger the
  // taxpayer has already reported from.
  //
  // The general ledger's own window IS waived, and only for that exception: closing a period closes
  // the ledger with it (the year-end close closes every module), so refusing an audit adjustment
  // because the *ledger* is closed refused it in the one situation it exists for — a closed year —
  // and every proposal failed with «the GL module is closed for Diciembre» (a 500, at that).
  const waived = options.allowClosedPeriod === true && module === ModuleSlug.GL;
  if (!waived && moduleStatusOf(period, module) === PeriodStatus.CLOSED) {
    throw new ConflictError('accounting.module_module_closed_period_name', {
      name: period.name,
      module,
    });
  }

  return period;
}

/** The horizon when a company's settings have none: the column's own default. */
export const DEFAULT_MAX_FUTURE_POSTING_DAYS = 31;

/**
 * The transaction-local setting a close writes: the last day of the period (or fiscal year) it is
 * closing. The entries the close itself books — depreciation, revaluation, the restatement for
 * inflation, the result transfer — are dated at that period's end, which a close made before the
 * period ends (`closeBeforeItEnds`) puts past the horizon; within that close, and only there, the
 * horizon reaches the end of what is being closed. `set_config(…, true)` scopes it to the
 * transaction: it is gone at commit, and nothing outside the database can set it.
 */
export const CLOSING_THROUGH_SETTING = 'app.closing_through';

/** Lets the postings of a close, on its transaction, be dated up to `endDate` (see above). */
export async function allowPostingsThrough(manager: EntityManager, endDate: Date | string): Promise<void> {
  await manager.query(`SELECT set_config($1, $2, true)`, [CLOSING_THROUGH_SETTING, toIsoDate(endDate)]);
}

/** `YYYY-MM-DD` plus `days`, on the calendar. */
function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The last date a posting may carry for a company (FIN-JE-02): its today, on its own clock, plus
 * the days its settings allow (`max_future_posting_days`) — and never before the end of the period
 * today falls in, so a month-end accrual or the month's depreciation can always be dated at the
 * period's end, whatever the setting.
 *
 * There was no limit, and a posting into a year with no calendar opened that year and its twelve
 * periods to receive it: a year mistyped by one changed the calendar. Exported for the forms that
 * want to say so before the person saves.
 */
export async function postingHorizon(
  manager: EntityManager,
  organizationId: string,
): Promise<{ today: string; limit: string; days: number }> {
  const [company]: Array<{ country: string | null; timezone: string | null; days: number | null; closing: string | null }> = await manager.query(
    `SELECT o.country, o.timezone, s.max_future_posting_days AS days,
            NULLIF(current_setting('${CLOSING_THROUGH_SETTING}', true), '') AS closing
       FROM organizations o
       LEFT JOIN organization_settings s ON s.organization_id = o.id
      WHERE o.id = $1`,
    [organizationId],
  );
  const today = fiscalDate(organizationTimeZone(company));
  const days = company?.days ?? DEFAULT_MAX_FUTURE_POSTING_DAYS;
  const ahead = addDays(today, days);
  const current = await findPeriodCovering(manager, organizationId, today);
  const periodEnd = current ? toIsoDate(current.endDate) : null;
  // The latest of: today plus the days allowed, the end of today's period, and the end of the
  // period a close on this transaction is closing.
  const limit = [ahead, periodEnd, company?.closing && /^\d{4}-\d{2}-\d{2}$/.test(company.closing) ? company.closing : null]
    .filter((date): date is string => Boolean(date))
    .reduce((latest, date) => (date > latest ? date : latest));
  return { today, limit, days };
}

/** The property on the period that carries `module`'s own open/closed state. */
export function moduleStatusColumn(module: ModuleSlug): keyof AccountingPeriod {
  switch (module) {
    case ModuleSlug.GL:
      return 'generalLedgerStatus';
    case ModuleSlug.AP:
      return 'accountsPayableStatus';
    case ModuleSlug.AR:
      return 'accountsReceivableStatus';
    case ModuleSlug.INVENTORY:
      return 'inventoryStatus';
    default: {
      const exhaustive: never = module;
      throw new Error(`Unknown accounting module: ${String(exhaustive)}`);
    }
  }
}

export function moduleStatusOf(
  period: AccountingPeriod,
  module: ModuleSlug,
): PeriodStatus {
  return period[moduleStatusColumn(module)] as PeriodStatus;
}

/**
 * The open/closed period whose window contains `isoDate`, or null.
 *
 * Exported for the documents that must check a date *before* posting — while it is still a draft
 * the person can correct — without the side effect `resolvePostingPeriod({ createIfMissing })`
 * has of opening a whole fiscal year for a mistyped date.
 */
export function findPeriodCovering(
  manager: EntityManager,
  organizationId: string,
  isoDate: string,
): Promise<AccountingPeriod | null> {
  return manager.findOne(AccountingPeriod, {
    where: {
      organizationId,
      startDate: LessThanOrEqual(isoDate as unknown as Date),
      endDate: MoreThanOrEqual(isoDate as unknown as Date),
    },
  });
}

/**
 * How far from the present a posting date may reach and still open its own fiscal year.
 *
 * Generous enough for a backlog imported from prior years and for planning a couple ahead; tight
 * enough that a mistyped year — `2206` for `2026` — is refused instead of conjuring a calendar two
 * centuries out and twelve periods nobody asked for. A date outside the window still posts if its
 * period was created deliberately; it simply will not create one by itself.
 */
const AUTO_OPEN_YEARS_BACK = 15;
/**
 * One year ahead: a next-year accrual or a January invoice keyed in December opens its year, but a
 * mistyped `2031` for `2026` no longer conjures five years of open periods (QA R3-A01). A date
 * further out posts only into a period someone created on purpose.
 */
const AUTO_OPEN_YEARS_AHEAD = 1;

/**
 * Open, on demand, the fiscal year the date belongs to, and return the period that now covers it.
 *
 * Returns null — so the caller raises the ordinary "no period" refusal — when the date is outside
 * the {@link AUTO_OPEN_YEARS_BACK}/{@link AUTO_OPEN_YEARS_AHEAD} window, or when a fiscal year that
 * already covers the date is closed or locked. A sealed book is never reopened by a stray posting;
 * the one entry that may land in a closed period, the audit adjustment, targets a period that
 * already exists and so never reaches here.
 */
async function materialisePeriodForDate(
  manager: EntityManager,
  organizationId: string,
  isoDate: string,
): Promise<AccountingPeriod | null> {
  const year = Number(isoDate.slice(0, 4));
  const thisYear = new Date().getUTCFullYear();
  if (year < thisYear - AUTO_OPEN_YEARS_BACK || year > thisYear + AUTO_OPEN_YEARS_AHEAD) {
    return null;
  }

  const existingYear = await manager.findOne(FiscalYear, {
    where: {
      organizationId,
      startDate: LessThanOrEqual(isoDate as unknown as Date),
      endDate: MoreThanOrEqual(isoDate as unknown as Date),
    },
  });
  if (existingYear && existingYear.status !== FiscalYearStatus.OPEN) {
    return null;
  }

  // The same calendar-month shape provisioning creates, built idempotently: a concurrent posting
  // on another date in the same year converges on the same fiscal year and twelve periods.
  await ensureFiscalYearWithPeriods(manager, organizationId, `${year}-01-01`, 12);

  return findPeriodCovering(manager, organizationId, isoDate);
}
