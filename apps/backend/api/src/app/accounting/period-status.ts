import { EntityManager, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import {
  AccountingPeriod,
  ModuleSlug,
  PeriodStatus,
} from './entities/accounting-period.entity';
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
  } = {},
): Promise<AccountingPeriod> {
  const isoDate = toIsoDate(date);

  const period = await manager.findOne(AccountingPeriod, {
    where: {
      organizationId,
      startDate: LessThanOrEqual(isoDate as unknown as Date),
      endDate: MoreThanOrEqual(isoDate as unknown as Date),
    },
  });

  if (!period) {
    throw new ForbiddenError(
      'ACCOUNTING.FECHA_TRANSACCION_NO_PERTENECE_NINGUN_PERIODO_CONTABLE',
      { p1: isoDate },
    );
  }

  if (period.status === PeriodStatus.CLOSED && !options.allowClosedPeriod) {
    throw new ForbiddenError(
      'ACCOUNTING.FECHA_TRANSACCION_ESTA_DENTRO_PERIODO_CONTABLE_YA',
      { name: period.name },
    );
  }

  // The subledger windows are not waived by the exception above: an audit adjustment is a general
  // ledger entry, and letting it into a closed payables month would put it in a subledger the
  // taxpayer has already reported from.
  if (moduleStatusOf(period, module) === PeriodStatus.CLOSED) {
    throw new ForbiddenError('ACCOUNTING.MODULO_CERRADO_PARA_PERIODO', {
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
