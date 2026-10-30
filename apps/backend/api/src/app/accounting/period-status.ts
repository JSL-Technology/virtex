import { EntityManager, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import {
  AccountingPeriod,
  ModuleSlug,
  PeriodStatus,
} from './entities/accounting-period.entity';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import { ensureFiscalYearWithPeriods } from './provisioning/fiscal-calendar';
import { ForbiddenError } from '../i18n/localized.exception';
import { toIsoDate } from '../chart-of-accounts/account-balances.service';

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

  let period = await findPeriodCovering(manager, organizationId, isoDate);

  if (!period && options.createIfMissing) {
    period = await materialisePeriodForDate(manager, organizationId, isoDate);
  }

  if (!period) {
    throw new ForbiddenError(
      'accounting.transaction_date_p1_does_not_fall',
      { p1: isoDate },
    );
  }

  if (period.status === PeriodStatus.CLOSED && !options.allowClosedPeriod) {
    throw new ForbiddenError(
      'accounting.transaction_date_falls_accounting_period_name',
      { name: period.name },
    );
  }

  // The subledger windows are not waived by the exception above: an audit adjustment is a general
  // ledger entry, and letting it into a closed payables month would put it in a subledger the
  // taxpayer has already reported from.
  if (moduleStatusOf(period, module) === PeriodStatus.CLOSED) {
    throw new ForbiddenError('accounting.module_module_closed_period_name', {
      name: period.name,
      module,
    });
  }

  return period;
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

/** The open/closed period whose window contains `isoDate`, or null. */
function findPeriodCovering(
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
